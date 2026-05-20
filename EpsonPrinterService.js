const escpos = require("escpos");
const findDevices = require("local-devices");
const net = require("net");
// 🔄 ALTERAÇÃO AQUI: Trocamos o escpos-network pelo escpos-usb
escpos.USB = require("escpos-usb");

class EpsonPrinterService {
  constructor() {
    this.device = null;
    this.printer = null;
    this.currentPrinterIp = null;
    this.isMock = false;
  }

  // Dentro da classe EpsonPrinterService:
  setPrinterName(nome) {
    this.printerName = nome; // Passa a usar o nome selecionado pelo usuário nas próximas impressões
  }

  /**
   * 🔍 Varre a rede local em busca de dispositivos com a porta 9100 aberta
   */
  async discoverPrinters() {
    console.log("[PRINTER] Iniciando varredura de rede...");
    try {
      const devices = await findDevices();
      const printerPromises = devices.map((device) =>
        this.checkPrinterPort(device.ip, 9100, device.name),
      );

      const foundPrinters = (await Promise.all(printerPromises)).filter(
        (p) => p !== null,
      );
      return foundPrinters;
    } catch (err) {
      console.error("[PRINTER_DISCOVERY_ERROR]", err);
      return [];
    }
  }

  /**
   * 🔐 Auxiliar para testar se a porta padrão do ESC/POS está acessível
   */
  checkPrinterPort(ip, port = 9100, osName) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1500);

      socket.on("connect", () => {
        socket.destroy();
        resolve({
          ip: ip,
          port: port,
          name:
            osName && osName !== "?" ? osName : `Impressora de Rede (${ip})`,
        });
      });

      socket.on("error", () => resolve(null));
      socket.on("timeout", () => resolve(null));

      socket.connect(port, ip);
    });
  }

  // 🔄 ALTERAÇÃO AQUI: Varredura de IP removida, entra a conexão USB direta
  connectToPrinter() {
    try {
      if (this.printerName) {
        console.log(
          `[PRINTER] Tentando conectar na impressora: ${this.printerName}`,
        );

        // Se o nome contiver "0x", significa que passamos o par VendorID/ProductID do USB
        if (this.printerName.includes("0x")) {
          const [vid, pid] = this.printerName.split("_");
          console.log(
            `[PRINTER] Identificado mapeamento USB Direto - VID: ${vid}, PID: ${pid}`,
          );
          this.device = new escpos.USB(parseInt(vid, 16), parseInt(pid, 16));
        } else {
          // Fallback para mapeamento por nome de fila/driver (Comum no Windows)
          this.device = new escpos.USB(this.printerName);
        }
      } else {
        console.log(
          "[PRINTER] Buscando qualquer dispositivo USB padrão conectado...",
        );
        this.device = new escpos.USB(); // Pega o primeiro dispositivo ESC/POS que responder na USB
      }

      this.printer = new escpos.Printer(this.device, { encoding: "CP860" });
      this.isMock = false;
      console.log("[PRINTER] Conectado com sucesso via hardware USB.");
      return { success: true };
    } catch (err) {
      this.isMock = true;
      console.error(
        "[PRINTER_CONN_ERROR] Falha ao parear com o hardware USB. Entrando em Modo Mock.",
        err.message,
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * 🖨️ Executa um teste de impressão (Mock ou Real baseado no estado da conexão)
   */
  async testPrint() {
    // Definição da constante corrigida (Evita o ReferenceError anterior)
    const LARGURA_MAX = 48;

    // Dados fictícios estruturados para o cupom
    const pedidoMock = {
      id: "9999",
      data: new Date().toLocaleString("pt-BR"),
      cliente: "FULANO DE TAL (TESTE)",
      itens: [
        { nome: "PIZZA CALABRESA", quantidade: 1, preco: 45.0 },
        { nome: "REFRIGERANTE 2L", quantidade: 2, preco: 9.0 },
      ],
      total: 63.0,
    };

    if (this.isMock) {
      // ==========================================
      // MODO MOCK: Apenas exibe no terminal formatado
      // ==========================================
      console.log(
        "\n⚠️ [PRINTER-MOCK] Sem impressora conectada. Exibindo preview no console:\n",
      );

      let linhas = [];
      linhas.push("=".repeat(LARGURA_MAX));
      linhas.push("         SISTEMA DE IMPRESSÃO (MOCK)        ");
      linhas.push("=".repeat(LARGURA_MAX));
      linhas.push(`Pedido: #${pedidoMock.id}`);
      linhas.push(`Data:   ${pedidoMock.data}`);
      linhas.push(`Cliente:${pedidoMock.cliente}`);
      linhas.push("-".repeat(LARGURA_MAX));

      pedidoMock.itens.forEach((item) => {
        const qtdPreco = `${item.quantidade}x R$ ${item.preco.toFixed(2)}`;
        const totalItem = `R$ ${(item.quantidade * item.preco).toFixed(2)}`;
        linhas.push(`${item.nome}`);
        linhas.push(
          `${qtdPreco.padEnd(LARGURA_MAX - totalItem.length)}${totalItem}`,
        );
      });

      linhas.push("-".repeat(LARGURA_MAX));
      const txtTotal = `TOTAL: R$ ${pedidoMock.total.toFixed(2)}`;
      linhas.push(txtTotal.padStart(LARGURA_MAX));
      linhas.push("=".repeat(LARGURA_MAX));

      console.log(linhas.join("\n"));
      console.log("\n[PRINTER-MOCK] Fim do espelho de teste.\n");
      return { success: true, mode: "mocked" };
    } else {
      // ==========================================
      // MODO IMPRESSÃO REAL: Envia comandos ESC/POS via rede
      // ==========================================
      console.log(
        `🚀 [PRINTER] Enviando impressão real para ${this.currentPrinterIp}...`,
      );

      return new Promise((resolve, reject) => {
        this.device.open((err) => {
          if (err) {
            console.error(
              "[PRINTER_WRITE_ERROR] Erro ao abrir a porta da impressora",
              err,
            );
            return reject({ success: false, error: err.message });
          }

          try {
            this.printer
              .font("a")
              .align("ct")
              .style("bu")
              .size(1, 1)
              .text("IMPRESSÃO DE TESTE REAL")
              .text("SISTEMA WIFI CONECTADO")
              .text("================================================") // 48 chars
              .align("lt")
              .style("normal")
              .text(`Pedido: #${pedidoMock.id}`)
              .text(`Data:   ${pedidoMock.data}`)
              .text(`Cliente:${pedidoMock.cliente}`)
              .text("------------------------------------------------");

            // Listando os itens usando comandos escpos nativos ou strings espaçadas
            pedidoMock.itens.forEach((item) => {
              const qtdPreco = `${item.quantidade}x R$ ${item.preco.toFixed(2)}`;
              const totalItem = `R$ ${(item.quantidade * item.preco).toFixed(2)}`;
              const espacosLivres = LARGURA_MAX - qtdPreco.length;
              const linhaValores = `${qtdPreco}${totalItem.padStart(espacosLivres)}`;

              this.printer.text(item.nome);
              this.printer.text(linhaValores);
            });

            const txtTotal = `TOTAL: R$ ${pedidoMock.total.toFixed(2)}`;

            this.printer
              .text("------------------------------------------------")
              .align("rt")
              .style("b") // Negrito no total
              .text(txtTotal)
              .align("ct")
              .text("================================================")
              .feed(4) // Avança o papel para corte
              .cut() // Guilhotina (se a impressora suportar)
              .close(); // Fecha a comunicação e libera o buffer do aparelho

            console.log("✅ [PRINTER] Enviado para a bobina com sucesso!");
            resolve({ success: true, mode: "real" });
          } catch (printErr) {
            this.printer.close();
            console.error(
              "[PRINTER_EXEC_ERROR] Falha na montagem do buffer ESC/POS",
              printErr,
            );
            reject({ success: false, error: printErr.message });
          }
        });
      });
    }
  }

  // 📏 Formatação de coluna (48 colunas padrão)
  _coluna(texto, tamanho, align = "left") {
    texto = String(texto || "");

    if (texto.length > tamanho) {
      // Em vez de apenas cortar, garante que termine de forma elegante ou use quebra externa
      return texto.substring(0, tamanho);
    }

    if (align === "right") {
      return texto.padStart(tamanho);
    }

    if (align === "center") {
      const left = Math.floor((tamanho - texto.length) / 2);
      const right = tamanho - texto.length - left;
      return " ".repeat(left) + texto + " ".repeat(right);
    }

    return texto.padEnd(tamanho);
  }

  // 🔄 Função auxiliar para quebrar textos longos (Ex: Obs e Endereços)
  _ajustarTextoLongo(texto, tamanhoMaximo, prefixo = "") {
    const linhas = [];
    const espacoDisponivel = tamanhoMaximo - prefixo.length;
    let restante = String(texto || "").trim();

    if (restante.length === 0) return [];

    // Se couber em uma linha com o prefixo
    if ((prefixo + restante).length <= tamanhoMaximo) {
      return [this._coluna(prefixo + restante, tamanhoMaximo)];
    }

    // Quebra o texto em blocos que cabem na linha
    while (restante.length > 0) {
      const atualPrefixo =
        linhas.length === 0 ? prefixo : " ".repeat(prefixo.length);
      const pedaco = restante.substring(0, espacoDisponivel);
      linhas.push(this._coluna(atualPrefixo + pedaco, tamanhoMaximo));
      restante = restante.substring(espacoDisponivel);
    }

    return linhas;
  }

  formatarPedido(pedido) {
    const LARGURA_MAX = 48;
    const linhas = [];

    // 🧾 Cabeçalho Comercial
    linhas.push(
      this._coluna("*** PRATINHO PRATUDO ***", LARGURA_MAX, "center"),
    );
    linhas.push(
      this._coluna("CNPJ: 57.678.701/0001-00", LARGURA_MAX, "center"),
    ); // Altere para o CNPJ real se houver
    linhas.push(
      this._coluna(
        "Rua Joaquim José da Silva, 1006, Vila Velha",
        LARGURA_MAX,
        "center",
      ),
    );
    linhas.push(this._coluna("Zap: (85) 99192 - 4340", LARGURA_MAX, "center"));
    linhas.push("-".repeat(LARGURA_MAX));
    linhas.push(this._coluna("CUPOM NÃO FISCAL", LARGURA_MAX, "center"));
    linhas.push("-".repeat(LARGURA_MAX));

    // 🔑 Identificação do Pedido
    linhas.push(this._coluna(`PEDIDO #${pedido.id}`, LARGURA_MAX, "center"));
    linhas.push("-".repeat(LARGURA_MAX));

    // 👤 Cliente
    linhas.push(this._coluna("CLIENTE:", LARGURA_MAX));
    linhas.push(this._coluna(`${pedido.cliente.nome}`, LARGURA_MAX));
    if (pedido.cliente.telefone) {
      linhas.push(this._coluna(`Tel: ${pedido.cliente.telefone}`, LARGURA_MAX));
    }
    linhas.push("-".repeat(LARGURA_MAX));

    // 📦 Itens
    linhas.push(this._coluna("ITENS:", LARGURA_MAX));
    linhas.push("-".repeat(LARGURA_MAX));

    pedido.itens.forEach((item) => {
      // 28 (nome) + 5 (qtd) + 7 (preco) + 8 (total) = 48 colunas
      const nome = this._coluna(item.name.toUpperCase(), 28);
      const qtd = this._coluna(`x${item.quantity}`, 5, "right");
      const preco = this._coluna(Number(item.unitPrice).toFixed(2), 7, "right");
      const total = this._coluna(
        (item.unitPrice * item.quantity).toFixed(2),
        8,
        "right",
      );

      linhas.push(`${nome}${qtd}${preco}${total}`);

      // Exibir Extras de forma segura (com quebra de linha se for muito longo)
      if (item.extras && item.extras.length > 0) {
        const textoExtras = item.extras.join(", ");
        const linhasExtras = this._ajustarTextoLongo(
          textoExtras,
          LARGURA_MAX || LARGURA_MAX,
          "  + ",
        );
        linhas.push(...linhasExtras);
      }

      // Exibir Observações de forma segura (Crucial para não cortar restrições alimentares)
      if (item.notes && item.notes.trim() !== "") {
        const linhasObs = this._ajustarTextoLongo(
          item.notes,
          LARGURA_MAX,
          "  OBS: ",
        );
        linhas.push(...linhasObs);
      }
    });

    linhas.push("-".repeat(LARGURA_MAX));

    // 🚚 Taxa de Entrega
    if (
      pedido.entrega &&
      pedido.entrega.tipo === "DELIVERY" &&
      pedido.entrega.taxaEntrega
    ) {
      linhas.push(
        this._coluna(
          `TAXA ENTREGA: R$ ${Number(pedido.entrega.taxaEntrega).toFixed(2)}`,
          LARGURA_MAX,
          "right",
        ),
      );
    }

    // 💰 Total
    if (pedido.pagamento) {
      linhas.push(
        this._coluna(
          `TOTAL GERAL: R$ ${Number(pedido.pagamento.total).toFixed(2)}`,
          LARGURA_MAX,
          "right",
        ),
      );
    }

    linhas.push("-".repeat(LARGURA_MAX));

    // 💳 Pagamento
    if (pedido.pagamento) {
      linhas.push(this._coluna("PAGAMENTO:", LARGURA_MAX));
      const statusPgto =
        pedido.pagamento.status === "PENDING"
          ? "PENDENTE"
          : pedido.pagamento.status;
      linhas.push(
        this._coluna(`${pedido.pagamento.metodo} (${statusPgto})`, LARGURA_MAX),
      );

      if (pedido.pagamento.trocoPara) {
        linhas.push(
          this._coluna(
            `Troco para: R$ ${Number(pedido.pagamento.trocoPara).toFixed(2)}`,
            LARGURA_MAX,
          ),
        );
      }
      linhas.push("-".repeat(LARGURA_MAX));
    }

    // 🚚 Entrega
    if (pedido.entrega) {
      linhas.push(this._coluna("ENTREGA:", LARGURA_MAX));

      if (pedido.entrega.tipo === "DELIVERY") {
        linhas.push(this._coluna("Tipo: Delivery (Entregar)", LARGURA_MAX));
        const endereco = pedido.entrega.endereco || pedido.cliente.endereco;
        const linhasEnd = this._ajustarTextoLongo(
          endereco,
          LARGURA_MAX,
          "End: ",
        );
        linhas.push(...linhasEnd);
      } else if (pedido.entrega.tipo === "PICKUP") {
        linhas.push(this._coluna("Tipo: Retirada no local", LARGURA_MAX));
      } else if (pedido.entrega.tipo === "DINE_IN") {
        linhas.push(this._coluna(`Mesa: ${pedido.entrega.mesa}`, LARGURA_MAX));
      }
      linhas.push("-".repeat(LARGURA_MAX));
    }

    // ⏰ Datas
    const dataCriacao = pedido.createdAt
      ? new Date(pedido.createdAt)
      : new Date();
    linhas.push(
      this._coluna(`Data: ${dataCriacao.toLocaleString("pt-BR")}`, LARGURA_MAX),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    // 🙏 Rodapé e Créditos do Sistema
    linhas.push(
      this._coluna("OBRIGADO PELA PREFERENCIA!", LARGURA_MAX, "center"),
    );
    linhas.push(
      this._coluna("Agradecemos a confianca.", LARGURA_MAX, "center"),
    );
    linhas.push(
      this._coluna("--------------------------------", LARGURA_MAX, "center"),
    );
    linhas.push(
      this._coluna("Impresso por: PRATINHOPRATUDO", LARGURA_MAX, "center"),
    );
    linhas.push("\n\n");

    // Retorna como Array para alimentar diretamente o linhas.forEach() do seu Service
    return linhas;
  }

  async imprimir(pedido) {
    let linhas = this.formatarPedido(pedido);

    // 🛡️ Segurança: Se o formatador retornou uma string única,
    // transforma de volta em Array quebrando nas quebras de linha (\n)
    if (typeof linhas === "string") {
      linhas = linhas.split("\n");
    }

    // 🧪 MODO MOCK (simula exatamente a impressora)
    if (this.isMock) {
      let buffer = [];

      const mockPrinter = {
        align: (pos) => {
          buffer.push(`[ALIGN: ${pos}]`);
          return mockPrinter;
        },
        style: (s) => {
          buffer.push(`[STYLE: ${s}]`);
          return mockPrinter;
        },
        size: (w, h) => {
          buffer.push(`[SIZE: ${w}x${h}]`);
          return mockPrinter;
        },
        text: (txt) => {
          buffer.push(txt);
          return mockPrinter;
        },
        feed: (n = 1) => {
          buffer.push("\n".repeat(n));
          return mockPrinter;
        },
        cut: () => {
          buffer.push("\n======== CORTE ========");
          return mockPrinter;
        },
        close: () => mockPrinter,
      };

      // 🔁 Simula fluxo real
      mockPrinter.align("CT").style("B").size(1, 1).text("PEDIDO").feed(1);

      mockPrinter.style("NORMAL").align("LT");

      linhas.forEach((linha) => {
        mockPrinter.text(linha);
      });

      mockPrinter.feed(2).cut().close();

      // 🖥️ Exibe no console
      console.log("\n🖨️ ===== MOCK IMPRESSÃO COMPLETA =====");
      buffer.forEach((l) => console.log(l));
      console.log("🖨️ ==================================\n");

      return true;
    }

    // 🖨️ IMPRESSÃO REAL (inalterado)
    return new Promise((resolve, reject) => {
      this.device.open((err) => {
        if (err) {
          console.error("[PRINTER_OPEN_ERROR]", err);
          return reject(new Error("Erro ao conectar na impressora"));
        }

        try {
          this.printer.align("CT").style("B").size(1, 1).text("PEDIDO").feed(1);

          this.printer.style("NORMAL").align("LT");

          linhas.forEach((linha) => {
            this.printer.text(linha);
          });

          this.printer.feed(2).cut().close();

          resolve(true);
        } catch (err) {
          console.error("[PRINT_ERROR]", err);
          reject(new Error("Erro ao imprimir"));
        }
      });
    });
  }
}

module.exports = EpsonPrinterService;
