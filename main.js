const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { io } = require("socket.io-client");

const EpsonPrinterService = require("./EpsonPrinterService");

let mainWindow;

const printerService = new EpsonPrinterService();

const configPath = path.join(app.getPath("userData"), "printer-config.json");

// ======================================================
// JANELA (VERSÃO CORRIGIDA)
// ======================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 800,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true, // Mantido conforme sua configuração original
      contextIsolation: false, // Mantido conforme sua configuração original
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Abre o console/devtools
  mainWindow.webContents.openDevTools();

  // ======================================================
  // LOGS E SINCRONIZAÇÃO INICIAL DE BOOT
  // ======================================================
  mainWindow.webContents.on("did-finish-load", async () => {
    console.log("✅ HTML carregado com sucesso");

    // 1. Carrega as configurações salvas no JSON
    await carregarConfiguracaoInicial();

    // 2. Pequena pausa de 300ms para garantir que os listeners do HTML estão escutando
    setTimeout(async () => {
      console.log("🔄 Disparando varredura inicial de impressoras...");
      await listarImpressorasInicial();
    }, 300);
  });

  // ======================================================
  // SOCKET
  // ======================================================
  iniciarSocket();
}

// ======================================================
// SOCKET.IO
// ======================================================

function iniciarSocket() {
  const socket = io("https://prafoodapi.onrender.com", {
    transports: ["websocket"],
    upgrade: false,
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => {
    console.log("🟢 Conectado na nuvem");

    enviarStatus("online");
  });

  socket.on("disconnect", () => {
    console.log("🔴 Desconectado da nuvem");

    enviarStatus("offline");
  });

  socket.on("connect_error", (err) => {
    console.error("❌ SOCKET ERROR:", err.message);

    enviarStatus("offline");
  });

  socket.on("imprimir-pedido", async (pedido) => {
    try {
      console.log("🖨️ Pedido recebido da nuvem:", pedido?._id);
      
      // 1. Pega o array de impressoras do Windows
      const printers = await obterImpressoras(); 
      
      // 2. Passa o nome para garantir que o service está atualizado
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config?.printerName) printerService.setPrinterName(config.printerName);
      }

      // 3. Conecta passando o array tratado
      await printerService.connectToPrinter(printers);
      await printerService.imprimir(pedido);
    } catch (err) {
      console.error("[IMPRESSAO_ERRO]", err);
    }
  });
}

// ======================================================
// STATUS
// ======================================================

function enviarStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("status-mudou", status);
}

// ======================================================
// CONFIGURAÇÃO INICIAL
// ======================================================

async function carregarConfiguracaoInicial() {
  try {
    if (!fs.existsSync(configPath)) {
      console.log("⚠️ Nenhuma configuração salva");

      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    if (config?.printerName) {
      printerService.setPrinterName(config.printerName);

      console.log(`🖨️ Impressora salva carregada: ${config.printerName}`);
    }
  } catch (err) {
    console.error("[CONFIG_LOAD_ERROR]", err);
  }
}

// ======================================================
// LISTAR IMPRESSORAS (VERSÃO PREVENTIVA PARA MAC)
// ======================================================
async function obterImpressoras() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return [];

    console.log("[PRINTER] Solicitando impressoras ao sistema...");

    // Criamos a promessa oficial do Electron
    const printersPromise = mainWindow.webContents.getPrintersAsync();

    // Criamos um timer de 2 segundos para o Mac não engasgar
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout OS Printer")), 2000),
    );

    // Corrida: quem responder primeiro ganha
    const printers = await Promise.race([printersPromise, timeoutPromise]);

    console.log("🖨️ Impressoras encontradas:", printers);
    return printers || [];
  } catch (err) {
    // Se der timeout ou erro de hardware no Mac, assume lista vazia e segue jogo
    console.error("[GET_PRINTERS_ERROR] Falha ou Timeout:", err.message);
    return [];
  }
}

async function listarImpressorasInicial() {
  try {
    const printers = await obterImpressoras();

    let impressoraSalva = "";

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

        impressoraSalva = config?.printerName || "";
      } catch (e) {
        console.error("[CONFIG_READ_ERROR]", e);
      }
    }

    mainWindow.webContents.send(
      "lista-impressoras-resposta",
      printers,
      impressoraSalva,
    );

    // STATUS

    if (printers.length === 0) {
      console.log("⚠️ Nenhuma impressora encontrada");

      enviarStatus("mock");

      return;
    }

    enviarStatus("online");
  } catch (err) {
    console.error("[LISTAR_PRINTERS_ERROR]", err);

    enviarStatus("offline");
  }
}

// ======================================================
// APP
// ======================================================

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ======================================================
// TESTE DE IMPRESSÃO
// ======================================================

ipcMain.on("solicitar-teste-impressao", async (event) => {
  console.log("🧪 Teste solicitado pelo HTML");

  const pedidoTesteFake = {
    id: "9999",
    cliente: {
      nome: "CLIENTE TESTE",
      telefone: "(85) 99999-9999",
    },
    itens: [
      {
        name: "X-BACON",
        quantity: 2,
        unitPrice: 25,
        extras: ["CHEDDAR"],
        notes: "Sem cebola",
      },
    ],
    pagamento: {
      total: 50,
      metodo: "PIX",
      status: "PAGO",
    },
    entrega: {
      tipo: "DELIVERY",
      endereco: "Rua Teste 123",
    },
    createdAt: new Date().toISOString(),
  };

  try {
    const printers = await obterImpressoras();

    await printerService.connectToPrinter(printers);

    const resultado = await printerService.imprimir(pedidoTesteFake);

    if (resultado && resultado.mock && resultado.linhas) {
      console.log("\n🧾 [MAIN LOG] - EXIBINDO CUPOM GERADO NO TERMINAL:");

      resultado.linhas.forEach((linha) => {
        console.log(linha);
      });

      console.log("==================================================\n");

      event.reply("cupom-simulado-render", resultado.linhas);
    }

    console.log("✅ Impressão teste enviada");

    // 🔥 importante
    event.reply("teste-impressao-concluido");
  } catch (err) {
    console.error("[TEST_PRINT_ERROR]", err);

    // 🔥 importante
    event.reply("teste-impressao-concluido");
  }
});

// ======================================================
// FORÇAR RECONEXÃO
// ======================================================

ipcMain.on("forcar-reconectar-usb", async () => {
  console.log("🔄 Reconectando impressoras...");

  await listarImpressorasInicial();
});

// ======================================================
// BUSCAR LISTA
// ======================================================
// ======================================================
// BUSCAR LISTA (ATUALIZADO)
// ======================================================
ipcMain.on("buscar-lista-impressoras", async (event) => {
  try {
    const printers = await obterImpressoras();
    let impressoraSalva = "";

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        impressoraSalva = config?.printerName || "";
      } catch (e) {
        console.error(e);
      }
    }

    console.log(
      "📋 Enviando impressoras para HTML. Encontradas:",
      printers.length,
    );

    // 1. Devolve o array (mesmo vazio) para popular o select
    event.reply("lista-impressoras-resposta", printers, impressoraSalva);

    // 2. Força o redirecionamento visual do status baseado no resultado real
    if (!printers || printers.length === 0) {
      console.log("🔄 Forçando estado do HTML para: mock");
      enviarStatus("mock");
    } else {
      enviarStatus("online");
    }
  } catch (err) {
    console.error("[IPC_PRINTER_LIST_ERROR]", err);
    event.reply("lista-impressoras-resposta", [], "");
    enviarStatus("offline");
  }
});

// ======================================================
// DEFINIR IMPRESSORA
// ======================================================

ipcMain.on("configurar-impressora-ativa", async (event, nomeImpressora) => {
  try {
    console.log("🖨️ Impressora selecionada:", nomeImpressora);

    if (!nomeImpressora) {
      enviarStatus("mock");

      return;
    }

    // SALVAR

    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          printerName: nomeImpressora,
        },
        null,
        2,
      ),
    );

    // SETAR

    printerService.setPrinterName(nomeImpressora);

    // VALIDAR

    const printers = await obterImpressoras();

    const exists = printers.some((printer) => printer.name === nomeImpressora);

    if (!exists) {
      console.log("❌ Impressora não encontrada");

      enviarStatus("mock");

      return;
    }

    console.log("✅ Impressora conectada");

    enviarStatus("online");
  } catch (err) {
    console.error("[SET_PRINTER_ERROR]", err);

    enviarStatus("offline");
  }
});
