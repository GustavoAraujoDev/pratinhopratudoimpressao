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
  const socket = io("http://127.0.0.1:3000", {
    transports: ["websocket", "polling"], // 🔄 PERMITE FALLBACK: Se o websocket falhar, o polling mantém o canal vivo
    upgrade: true, // 🔄 PERMITE UPGRADE: Tenta subir para websocket assim que estabilizar
    forceNew: false, // Evita recriar instâncias desnecessárias se já houver tentativa ativa
    reconnection: true,
    reconnectionAttempts: Infinity, // Tenta reconectar para sempre
    reconnectionDelay: 1000, // Tempo inicial de espera
    reconnectionDelayMax: 5000, // Teto máximo de espera entre tentativas (evita flood)
    timeout: 20000, // Define 20s como limite para considerar queda real
  });

  socket.on("connect", () => {
    registrarLog("Conectado na nuvem (Socket.io)", "sucesso");
    enviarStatus("online");
  });

  socket.on("disconnect", (reason) => {
    registrarLog("Desconectado da nuvem", "erro");
    enviarStatus("offline");

    // Se a queda foi iniciada pelo servidor (ex: restart do backend), força o socket a tentar reconectar manualmente
    if (reason === "io server disconnect") {
      socket.connect();
    }
  });

  // 🔥 GERENCIADORES GERADOS PELO RECONNECTION AUTOMÁTICO
  socket.io.on("reconnect_attempt", (attempt) => {
    registrarLog(
      `Tentativa de reconexão automática nº ${attempt}...`,
      "alerta",
    );
  });

  socket.io.on("reconnect_failed", () => {
    registrarLog(
      "Falha crítica: Ciclo de reconexão esgotado. Forçando reinicialização do canal...",
      "erro",
    );
    socket.connect(); // Força uma reconexão bruta se o motor automático desistir
  });

  socket.on("connect_error", (err) => {
    registrarLog(`Erro na conexão Socket: ${err.message}`, "erro");
    enviarStatus("offline");
  });

  socket.on("imprimir-pedido", async (pedido) => {
    try {
      registrarLog(
        `Pedido recebido da nuvem. ID: ${pedido?.id || "Desconhecido"}`,
        "info",
      );

      const printers = await obterImpressoras();

      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config?.printerName)
          printerService.setPrinterName(config.printerName);
      }

      await printerService.connectToPrinter(printers);
      registrarLog(
        `Estado da impressora atualizado. IsMock: ${printerService.isMock}`,
        "info",
      );

      await printerService.imprimir(pedido);
      registrarLog(
        "Pedido impresso com sucesso a partir do fluxo da nuvem",
        "sucesso",
      );
    } catch (err) {
      registrarLog(`Falha na impressão do pedido: ${err.message}`, "erro");
    }
  });

  // 🔥 2. NOVO: ESCUTA DA IMPRESSÃO PARCIAL DE MESA
  socket.on("imprimir-parcial", async (dadosParcial) => {
    try {
      registrarLog(
        `Impressão parcial recebida para a Mesa: ${dadosParcial?.mesaId || "Desconhecida"}`,
        "info",
      );

      const printers = await obterImpressoras();

      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config?.printerName)
          printerService.setPrinterName(config.printerName);
      }

      await printerService.connectToPrinter(printers);
      registrarLog(
        `Estado da impressora atualizado. IsMock: ${printerService.isMock}`,
        "info",
      );

      // 💡 Verifica se o seu serviço possui um layout exclusivo para parciais.
      // Se não tiver, ele usa o método de impressão genérico, já que a estrutura de itens é idêntica.
      if (typeof printerService.imprimirParcial === "function") {
        await printerService.imprimirParcial(dadosParcial);
      } else {
        await printerService.imprimir(dadosParcial);
      }

      registrarLog(
        `Parcial da Mesa ${dadosParcial?.mesaId} impressa com sucesso no Agente Local`,
        "sucesso",
      );
    } catch (err) {
      registrarLog(
        `Falha na impressão parcial da mesa: ${err.message}`,
        "erro",
      );
    }
  });

  // 🔥 ESCUTA EXCLUSIVA DO RECIBO DE ABATIMENTO PARCIAL (DINHEIRO RECEBIDO)
  socket.on("imprimir-recibo-abatimento", async (dadosRecibo) => {
    // 👈 Mudou o nome do evento
    try {
      registrarLog(
        `Recibo de abatimento recebido para a Mesa: ${dadosRecibo?.mesaId || "Desconhecida"}`,
        "info",
      );

      const printers = await obterImpressoras();

      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config?.printerName)
          printerService.setPrinterName(config.printerName);
      }

      await printerService.connectToPrinter(printers);
      registrarLog(
        `Estado da impressora atualizado. IsMock: ${printerService.isMock}`,
        "info",
      );

      // Chama o método que gera o layout de recibo de pagamento
      if (typeof printerService.imprimirReciboAbatimento === "function") {
        await printerService.imprimirReciboAbatimento(dadosRecibo);
      } else {
        await printerService.imprimir(dadosRecibo);
      }

      registrarLog(
        `Recibo de abatimento da Mesa ${dadosRecibo?.mesaId} impresso com sucesso!`,
        "sucesso",
      );
    } catch (err) {
      registrarLog(
        `Falha na impressão do recibo de abatimento: ${err.message}`,
        "erro",
      );
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
      registrarLog(
        `Impressora carregada do JSON: ${config.printerName}`,
        "info",
      );
    }
  } catch (err) {
    registrarLog(`Erro ao carregar arquivo de config: ${err.message}`, "erro");
  }
}

// ======================================================
// BUSCA REAL DE IMPRESSORAS DO WINDOWS (ATUALIZADO)
// ======================================================
async function obterImpressoras() {
  // Mantém um fallback simulado para seus testes locais no macOS
  if (process.platform === "darwin") {
    registrarLog(
      "Ambiente macOS detectado. Retornando impressora fictícia para testes.",
      "info",
    );
    return [{ name: "Minha_Impressora_Virtual", isDefault: true }];
  }

  try {
    registrarLog(
      "Solicitando impressoras ao sistema operacional Windows...",
      "info",
    );

    if (!mainWindow || mainWindow.isDestroyed()) return [];

    const printersPromise = mainWindow.webContents.getPrintersAsync();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout ao listar impressoras")),
        3000,
      ),
    );

    // Executa a busca real ou falha se travar por mais de 3 segundos
    const printers = await Promise.race([printersPromise, timeoutPromise]);

    registrarLog(
      `Varredura concluída. Encontradas: ${printers ? printers.length : 0} impressora(s)`,
      "info",
    );
    return printers || [];
  } catch (err) {
    registrarLog(
      `Falha/Timeout no Spooler de Impressão: ${err.message}`,
      "erro",
    );
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

    mainWindow.webContents.send(
      "lista-impressoras-resposta",
      printers,
      impressoraSalva,
    );

    if (printers.length === 0) {
      registrarLog(
        "Nenhuma impressora instalada no Windows detectada. Modo simulador forçado.",
        "alerta",
      );
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
    itens: [
      {
        name: "X-BACON",
        quantity: 2,
        unitPrice: 25,
        extras: ["CHEDDAR"],
        notes: "Sem cebola",
      },
    ],
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
      registrarLog(
        "Impressora física inacessível. Exibindo cupom simulado no terminal",
        "alerta",
      );
      event.reply("cupom-simulado-render", resultado.linhas);
    } else {
      registrarLog(
        "Comando de impressão enviado com sucesso para a fila de impressão do Windows",
        "sucesso",
      );
    }

    event.reply("teste-impressao-concluido");
  } catch (err) {
    // Se err.message não existir, ele converte o objeto/string inteiro para texto
    const mensagemErro = err?.message || JSON.stringify(err) || String(err);
    registrarLog(
      `Erro crítico durante o teste de impressão: ${mensagemErro}`,
      "erro",
    );
    event.reply("teste-impressao-concluido");
  }
});

ipcMain.on("forcar-reconectar-usb", async () => {
  registrarLog(
    "Solicitação manual de atualização de hardware recebida",
    "info",
  );
  await listarImpressorasInicial();
});

ipcMain.on("buscar-lista-impressoras", async (event) => {
  try {
    registrarLog(
      "Buscando lista atualizada de dispositivos de impressão...",
      "info",
    );
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
    registrarLog(
      `Erro ao responder busca de impressoras: ${err.message}`,
      "erro",
    );
    event.reply("lista-impressoras-resposta", [], "");
    enviarStatus("offline");
  }
});

ipcMain.on("configurar-impressora-ativa", async (event, nomeImpressora) => {
  try {
    registrarLog(
      `Mudança de impressora solicitada: ${nomeImpressora || "Nenhuma"}`,
      "info",
    );

    if (!nomeImpressora) {
      enviarStatus("mock");
      return;
    }

    fs.writeFileSync(
      configPath,
      JSON.stringify({ printerName: nomeImpressora }, null, 2),
    );
    printerService.setPrinterName(nomeImpressora);

    const printers = await obterImpressoras();
    const exists = printers.some((printer) => printer.name === nomeImpressora);

    if (!exists) {
      registrarLog(
        `A impressora '${nomeImpressora}' está salva mas não foi localizada fisicamente no Windows`,
        "alerta",
      );
      enviarStatus("mock");
      return;
    }

    registrarLog(
      `Impressora '${nomeImpressora}' validada e pronta para uso corporativo`,
      "sucesso",
    );
    enviarStatus("online");
  } catch (err) {
    registrarLog(`Erro ao salvar nova impressora: ${err.message}`, "erro");
    enviarStatus("offline");
  }
});

// Canal genérico capturar ações do front-end
ipcMain.on("usuario-clicou", (event, dados) => {
  registrarLog(
    `Ação disparada no HTML: Interação com [${dados.elemento}]`,
    "info",
  );
});
