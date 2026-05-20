const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { io } = require("socket.io-client");
const EpsonPrinterService = require("./EpsonPrinterService");
const fs = require("fs");

let mainWindow;
const printerService = new EpsonPrinterService();
const configPath = path.join(app.getPath("userData"), "printer-config.json");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 450,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (
        config.printerName &&
        typeof printerService.setPrinterName === "function"
      ) {
        printerService.setPrinterName(config.printerName);
      }
    } catch (e) {
      console.error("[CONFIG] Erro ao ler configuração inicial:", e);
    }
  }

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[ELECTRON] Janela carregada. Verificando hardware inicial...");
    const conexao = printerService.connectToPrinter();
    mainWindow.webContents.send(
      "status-mudou",
      conexao.success ? "online" : "mock",
    );
  });

  const socket = io("https://prafoodapi.onrender.com", {
    transports: ["websocket"],
    upgrade: false,
    forceNew: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => {
    console.log("Conectado na nuvem!");
    const conexao = printerService.connectToPrinter();
    mainWindow.webContents.send(
      "status-mudou",
      conexao.success ? "online" : "mock",
    );
  });

  socket.on("disconnect", () => {
    mainWindow.webContents.send("status-mudou", "offline");
  });

  socket.on("imprimir-pedido", async (pedido) => {
    console.log("Pedido recebido para impressão:", pedido?._id);
    try {
      if (printerService) {
        await printerService.imprimir(pedido);
      } else {
        throw new Error("Serviço de impressão não inicializado.");
      }
    } catch (error) {
      console.error(
        "[IMPRESSAO_ERRO] Falha ao imprimir pedido recebido da nuvem:",
        error.message,
      );
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ==========================================
// CANAIS DE COMUNICAÇÃO DOS BOTÕES (IPC)
// ==========================================

ipcMain.on("solicitar-teste-impressao", async () => {
  console.log("➔ Botão de Teste pressionado no HTML!");

  const pedidoTesteFake = {
    id: "0000",
    cliente: { nome: "FULANO DE TAL (TESTE)", telefone: "(85) 99999-9999" },
    itens: [
      {
        name: "Pizza Calabresa Grande",
        quantity: 1,
        unitPrice: 45.0,
        extras: ["Borda de Catupiry"],
        notes: "Sem cebola por favor.",
      },
      {
        name: "Coca-Cola Zero 2L",
        quantity: 1,
        unitPrice: 9.0,
        extras: [],
        notes: "",
      },
    ],
    pagamento: {
      total: 54.0,
      metodo: "CARTÃO DE CRÉDITO",
      status: "PENDING",
      trocoPara: 0,
    },
    entrega: {
      tipo: "DELIVERY",
      taxaEntrega: 5.0,
      endereco: "Av. Beira Mar, 1234 - Apto 502, Meireles",
    },
    createdAt: new Date().toISOString(),
  };

  try {
    if (printerService) {
      await printerService.imprimir(pedidoTesteFake);
    }
  } catch (err) {
    console.error("[ELECTRON_TEST_ERROR]", err.message);
  }
});

ipcMain.on("forcar-reconectar-usb", () => {
  console.log("➔ Botão de Forçar USB pressionado no HTML!");
  if (printerService) {
    const conexao = printerService.connectToPrinter();
    mainWindow.webContents.send(
      "status-mudou",
      conexao.success ? "online" : "mock",
    );
  }
});

// 💡 Adicionamos o "async" antes de (event) para permitir o uso de await
ipcMain.on("buscar-lista-impressoras", async (event) => {
  let impressorasdoSistema = [];

  try {
    // 🔑 O PADRÃO MODERNO COMERCIAL: Busca assíncrona blindada
    if (event.sender && typeof event.sender.getPrintersAsync === "function") {
      impressorasdoSistema = await event.sender.getPrintersAsync();
    } else if (
      mainWindow &&
      mainWindow.webContents &&
      typeof mainWindow.webContents.getPrintersAsync === "function"
    ) {
      impressorasdoSistema = await mainWindow.webContents.getPrintersAsync();
    } else {
      // Fallback de segurança para versões antigas se tudo falhar
      impressorasdoSistema = event.sender.getPrinters();
    }
  } catch (err) {
    console.error(
      "[PRINTER_LIST_ERROR] Erro ao varrer impressoras do SO:",
      err.message,
    );
    impressorasdoSistema = []; // Evita que o app quebre se o SO bloquear a leitura
  }

  let configuradaAnteriormente = "";

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      configuradaAnteriormente = config.printerName || "";
    } catch (e) {
      console.error(e);
    }
  }

  // Devolve a resposta para o HTML normalmente
  event.reply(
    "lista-impressoras-resposta",
    impressorasdoSistema,
    configuradaAnteriormente,
  );
});

ipcMain.on("configurar-impressora-ativa", (event, nomeImpressora) => {
  console.log(`📌 Usuário selecionou a impressora: ${nomeImpressora}`);

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ printerName: nomeImpressora }),
    );

    if (printerService && typeof printerService.setPrinterName === "function") {
      printerService.setPrinterName(nomeImpressora);
    }

    const conexao = printerService.connectToPrinter();
    mainWindow.webContents.send(
      "status-mudou",
      conexao.success ? "online" : "mock",
    );
  } catch (err) {
    console.error("[CONFIG_SAVE_ERROR]", err.message);
  }
});
