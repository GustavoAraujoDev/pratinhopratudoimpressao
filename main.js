const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { io } = require("socket.io-client");

const EpsonPrinterService = require("./EpsonPrinterService");

let mainWindow;
const printerService = new EpsonPrinterService();
const configPath = path.join(app.getPath("userData"), "printer-config.json");

// ======================================================
// ENVIAR LOGS DO PROCESSO PRINCIPAL PARA A TELA (NOVO)
// ======================================================
function registrarLog(mensagem, tipo = "info") {
  const timestamp = new Date().toLocaleTimeString("pt-BR");
  const logFormatado = `[${timestamp}] [${tipo.toUpperCase()}] ${mensagem}`;
  
  // Exibe no terminal do terminal do VSCode/Prompt
  console.log(logFormatado);

  // Envia para o HTML se a janela já estiver pronta
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("novo-log-servidor", logFormatado);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 850, // Aumentado um pouco para acomodar o terminal na tela
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on("did-finish-load", async () => {
    registrarLog("HTML carregado com sucesso", "sucesso");

    await carregarConfiguracaoInicial();

    setTimeout(async () => {
      registrarLog("Disparando varredura inicial de impressoras...", "info");
      await listarImpressorasInicial();
    }, 300);
  });

  iniciarSocket();
}

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
    registrarLog("Conectado na nuvem (Socket.io)", "sucesso");
    enviarStatus("online");
  });

  socket.on("disconnect", () => {
    registrarLog("Desconectado da nuvem", "erro");
    enviarStatus("offline");
  });

  socket.on("connect_error", (err) => {
    registrarLog(`Erro na conexão Socket: ${err.message}`, "erro");
    enviarStatus("offline");
  });

  socket.on("imprimir-pedido", async (pedido) => {
    try {
      registrarLog(`Pedido recebido da nuvem. ID: ${pedido?._id || "Desconhecido"}`, "info");
      
      const printers = await obterImpressoras(); 
      
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config?.printerName) printerService.setPrinterName(config.printerName);
      }

      await printerService.connectToPrinter(printers);
      registrarLog(`Estado da impressora atualizado. IsMock: ${printerService.isMock}`, "info");
      
      await printerService.imprimir(pedido);
      registrarLog("Pedido impresso com sucesso a partir do fluxo da nuvem", "sucesso");
    } catch (err) {
      registrarLog(`Falha na impressão do pedido: ${err.message}`, "erro");
    }
  });
}

function enviarStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("status-mudou", status);
}

async function carregarConfiguracaoInicial() {
  try {
    if (!fs.existsSync(configPath)) {
      registrarLog("Nenhuma configuração local salva previamente", "alerta");
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    if (config?.printerName) {
      printerService.setPrinterName(config.printerName);
      registrarLog(`Impressora carregada do JSON: ${config.printerName}`, "info");
    }
  } catch (err) {
    registrarLog(`Erro ao carregar arquivo de config: ${err.message}`, "erro");
  }
}

async function obterImpressoras() {
  try {
    registrarLog("Solicitando impressoras ao sistema operacional Windows...", "info");

    const printersPromise = mainWindow.webContents.getPrintersAsync();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout ao listar impressoras")), 2000),
    );

    const printers = await Promise.race([printersPromise, timeoutPromise]);
    registrarLog(`Varredura concluída. Encontradas: ${printers ? printers.length : 0} impressora(s)`, "info");
    return printers || [];
  } catch (err) {
    registrarLog(`Falha/Timeout no Spooler de Impressão: ${err.message}`, "erro");
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
        registrarLog("Erro ao ler arquivo de configuração", "erro");
      }
    }

    mainWindow.webContents.send("lista-impressoras-resposta", printers, impressoraSalva);

    if (printers.length === 0) {
      registrarLog("Nenhuma impressora instalada no Windows detectada. Modo simulador forçado.", "alerta");
      enviarStatus("mock");
      return;
    }

    enviarStatus("online");
  } catch (err) {
    registrarLog(`Erro ao listar impressoras iniciais: ${err.message}`, "erro");
    enviarStatus("offline");
  }
}

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
  registrarLog("Teste acionado pelo operador na interface HTML", "info");

  const pedidoTesteFake = {
    id: "9999",
    cliente: { nome: "CLIENTE TESTE", telefone: "(85) 99999-9999" },
    itens: [{ name: "X-BACON", quantity: 2, unitPrice: 25, extras: ["CHEDDAR"], notes: "Sem cebola" }],
    pagamento: { total: 50, metodo: "PIX", status: "PAGO" },
    entrega: { tipo: "DELIVERY", endereco: "Rua Teste 123" },
    createdAt: new Date().toISOString(),
  };

  try {
    const printers = await obterImpressoras();

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config?.printerName) {
        printerService.setPrinterName(config.printerName);
      }
    }

    await printerService.connectToPrinter(printers);
    const resultado = await printerService.imprimir(pedidoTesteFake);

    if (resultado && resultado.mock && resultado.linhas) {
      registrarLog("Impressora física inacessível. Exibindo cupom simulado no terminal", "alerta");
      event.reply("cupom-simulado-render", resultado.linhas);
    } else {
      registrarLog("Comando de impressão enviado com sucesso para a fila de impressão do Windows", "sucesso");
    }

    event.reply("teste-impressao-concluido");
  } catch (err) {
    registrarLog(`Erro crítico durante o teste de impressão: ${err.message}`, "erro");
    event.reply("teste-impressao-concluido");
  }
});

ipcMain.on("forcar-reconectar-usb", async () => {
  registrarLog("Solicitação manual de atualização de hardware recebida", "info");
  await listarImpressorasInicial();
});

ipcMain.on("buscar-lista-impressoras", async (event) => {
  try {
    registrarLog("Buscando lista atualizada de dispositivos de impressão...", "info");
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

    event.reply("lista-impressoras-resposta", printers, impressoraSalva);

    if (!printers || printers.length === 0) {
      enviarStatus("mock");
    } else {
      enviarStatus("online");
    }
  } catch (err) {
    registrarLog(`Erro ao responder busca de impressoras: ${err.message}`, "erro");
    event.reply("lista-impressoras-resposta", [], "");
    enviarStatus("offline");
  }
});

ipcMain.on("configurar-impressora-ativa", async (event, nomeImpressora) => {
  try {
    registrarLog(`Mudança de impressora solicitada: ${nomeImpressora || "Nenhuma"}`, "info");

    if (!nomeImpressora) {
      enviarStatus("mock");
      return;
    }

    fs.writeFileSync(configPath, JSON.stringify({ printerName: nomeImpressora }, null, 2));
    printerService.setPrinterName(nomeImpressora);

    const printers = await obterImpressoras();
    const exists = printers.some((printer) => printer.name === nomeImpressora);

    if (!exists) {
      registrarLog(`A impressora '${nomeImpressora}' está salva mas não foi localizada fisicamente no Windows`, "alerta");
      enviarStatus("mock");
      return;
    }

    registrarLog(`Impressora '${nomeImpressora}' validada e pronta para uso corporativo`, "sucesso");
    enviarStatus("online");
  } catch (err) {
    registrarLog(`Erro ao salvar nova impressora: ${err.message}`, "erro");
    enviarStatus("offline");
  }
});

// Canal genérico capturar ações do front-end
ipcMain.on("usuario-clicou", (event, dados) => {
  registrarLog(`Ação disparada no HTML: Interação com [${dados.elemento}]`, "info");
});
