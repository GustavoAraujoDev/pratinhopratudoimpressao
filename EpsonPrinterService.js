const escpos = require("escpos");
escpos.USB = require("escpos-usb");

const PDFDocument = require("pdfkit");
const { print } = require("pdf-to-printer");

class EpsonPrinterService {
  constructor() {
    this.device = null;
    this.printer = null;

    this.printerName = null;

    this.isMock = true;

    this.isConnected = false;
  }

  // =========================================================
  // DEFINIR IMPRESSORA
  // =========================================================

  setPrinterName(nome) {
    this.printerName = nome;
  }

  // =========================================================
  // CONECTAR IMPRESSORA WINDOWS
  // =========================================================

  // =========================================================
  // CONECTAR IMPRESSORA WINDOWS (CORRIGIDO)
  // =========================================================

  async connectToPrinter(printersList) { // Recebe a lista direto
    try {
      console.log("[PRINTER] Validando impressora...");

      if (!this.printerName) {
        console.log("[PRINTER] Nenhuma impressora configurada.");
        this.isMock = true;
        this.isConnected = false;
        return { success: false, error: "Nenhuma impressora configurada" };
      }

      // Se por acaso vier vazio ou não for array, evita quebrar o app
      const printers = Array.isArray(printersList) ? printersList : [];

      console.log("[PRINTER] Lista de verificação recebida, tamanho:", printers.length);

      const printerExists = printers.find((p) => p.name === this.printerName);

      if (!printerExists) {
        console.log(`[PRINTER] Impressora não encontrada no Windows: ${this.printerName}`);
        this.isMock = true;
        this.isConnected = false;
        return { success: false, error: "Impressora não encontrada" };
      }

      console.log(`[PRINTER] Hardware validado com sucesso: ${this.printerName}`);

      this.device = null;
      this.printer = null;
      this.isMock = false; // 🔥 AGORA SAI DO MODO MOCK COM SUCESSO
      this.isConnected = true;

      return { success: true };
    } catch (err) {
      console.error("[PRINTER_CONNECT_ERROR]", err);
      this.isMock = true;
      this.isConnected = false;
      return { success: false, error: err.message };
    }
  }

  // =========================================================
  // FORMATADOR DE COLUNA
  // =========================================================

  _coluna(texto, tamanho, align = "left") {
    texto = String(texto || "");

    if (texto.length > tamanho) {
      texto = texto.substring(0, tamanho);
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

  // =========================================================
  // QUEBRAR TEXTO
  // =========================================================

  _ajustarTextoLongo(texto, tamanhoMaximo, prefixo = "") {
    const linhas = [];

    const espacoDisponivel = tamanhoMaximo - prefixo.length;

    let restante = String(texto || "").trim();

    if (!restante) return [];

    while (restante.length > 0) {
      const atualPrefixo =
        linhas.length === 0 ? prefixo : " ".repeat(prefixo.length);

      const parte = restante.substring(0, espacoDisponivel);

      linhas.push(this._coluna(atualPrefixo + parte, tamanhoMaximo));

      restante = restante.substring(espacoDisponivel);
    }

    return linhas;
  }

  // =========================================================
  // FORMATAR PEDIDO
  // =========================================================

  formatarPedido(pedido) {
    const LARGURA_MAX = 48;

    const linhas = [];

    linhas.push(
      this._coluna("*** PRATINHO PRATUDO ***", LARGURA_MAX, "center"),
    );

    linhas.push(this._coluna("CUPOM NÃO FISCAL", LARGURA_MAX, "center"));

    linhas.push("-".repeat(LARGURA_MAX));

    linhas.push(this._coluna(`PEDIDO #${pedido.id}`, LARGURA_MAX, "center"));

    linhas.push("-".repeat(LARGURA_MAX));

    // =====================================================
    // CLIENTE
    // =====================================================

    linhas.push("CLIENTE:");

    linhas.push(
      this._coluna(pedido?.cliente?.nome || "Não informado", LARGURA_MAX),
    );

    if (pedido?.cliente?.telefone) {
      linhas.push(this._coluna(`Tel: ${pedido.cliente.telefone}`, LARGURA_MAX));
    }

    linhas.push("-".repeat(LARGURA_MAX));

    // =====================================================
    // ITENS
    // =====================================================

    linhas.push("ITENS:");

    linhas.push("-".repeat(LARGURA_MAX));

    (pedido.itens || []).forEach((item) => {
      const nome = this._coluna((item.name || "").toUpperCase(), 28);

      const qtd = this._coluna(`x${item.quantity}`, 5, "right");

      const preco = this._coluna(
        Number(item.unitPrice || 0).toFixed(2),
        7,
        "right",
      );

      const total = this._coluna(
        (Number(item.unitPrice || 0) * Number(item.quantity || 0)).toFixed(2),
        8,
        "right",
      );

      linhas.push(`${nome}${qtd}${preco}${total}`);

      // EXTRAS

      if (item.extras && item.extras.length > 0) {
        const textoExtras = item.extras.join(", ");

        linhas.push(
          ...this._ajustarTextoLongo(textoExtras, LARGURA_MAX, "  + "),
        );
      }

      // OBS

      if (item.notes && item.notes.trim() !== "") {
        linhas.push(
          ...this._ajustarTextoLongo(item.notes, LARGURA_MAX, "  OBS: "),
        );
      }
    });

    linhas.push("-".repeat(LARGURA_MAX));

    // =====================================================
    // ENTREGA
    // =====================================================

    if (pedido.entrega) {
      linhas.push("ENTREGA:");

      if (pedido.entrega.tipo === "DELIVERY") {
        linhas.push("Tipo: Delivery");

        const endereco =
          pedido.entrega.endereco || pedido?.cliente?.endereco || "";

        linhas.push(...this._ajustarTextoLongo(endereco, LARGURA_MAX, "End: "));
      }

      if (pedido.entrega.tipo === "PICKUP") {
        linhas.push("Tipo: Retirada");
      }

      if (pedido.entrega.tipo === "DINE_IN") {
        linhas.push(`Mesa: ${pedido.entrega.mesa}`);
      }

      linhas.push("-".repeat(LARGURA_MAX));
    }

    // =====================================================
    // PAGAMENTO
    // =====================================================

    if (pedido.pagamento) {
      linhas.push("PAGAMENTO:");

      linhas.push(
        `${pedido.pagamento.metodo || "Não informado"} (${pedido.pagamento.status || "PENDENTE"})`,
      );

      if (pedido.pagamento.trocoPara) {
        linhas.push(
          `Troco para: R$ ${Number(pedido.pagamento.trocoPara).toFixed(2)}`,
        );
      }

      linhas.push("-".repeat(LARGURA_MAX));

      linhas.push(
        this._coluna(
          `TOTAL: R$ ${Number(pedido.pagamento.total || 0).toFixed(2)}`,
          LARGURA_MAX,
          "right",
        ),
      );
    }

    linhas.push("-".repeat(LARGURA_MAX));

    const dataCriacao = pedido.createdAt
      ? new Date(pedido.createdAt)
      : new Date();

    linhas.push(
      this._coluna(`Data: ${dataCriacao.toLocaleString("pt-BR")}`, LARGURA_MAX),
    );

    linhas.push("-".repeat(LARGURA_MAX));

    linhas.push(
      this._coluna("OBRIGADO PELA PREFERENCIA!", LARGURA_MAX, "center"),
    );

    linhas.push("\n\n");

    return linhas;
  }

  // =========================================================
  // TESTE DE IMPRESSÃO
  // =========================================================

  async testPrint() {
    const pedidoTeste = {
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
          extras: ["CHEDDAR", "OVO"],
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

    return this.imprimir(pedidoTeste);
  }

  // =========================================================
  // IMPRIMIR
  // =========================================================

  async imprimir(pedido) {
    try {
      const linhas = this.formatarPedido(pedido);

      // =====================================================
      // MOCK (RETORNA AS LINHAS PARA O BACKEND ENVIAR PRO HTML)
      // =====================================================
      if (this.isMock || !this.printerName) {
        console.log("\n🧪 ===== MOCK IMPRESSÃO (ENVIANDO PRO HTML) =====");

        // Retornamos um objeto avisando que é mock e enviando o cupom estruturado
        return {
          success: true,
          mock: true,
          linhas: linhas,
        };
      }

      // =====================================================
      // WINDOWS SPOOLER
      // =====================================================

      const tempDir = require("os").tmpdir();

      const filePath = require("path").join(
        tempDir,
        `pedido-${Date.now()}.pdf`,
      );

      // =====================================================
      // GERAR PDF
      // =====================================================

      const doc = new PDFDocument({
        margin: 10,
        size: [226, 1000],
      });

      const stream = require("fs").createWriteStream(filePath);

      doc.pipe(stream);

      doc.fontSize(9);

      linhas.forEach((linha) => {
        doc.text(linha, {
          align: "left",
        });
      });

      doc.end();

      // =====================================================
      // AGUARDAR PDF
      // =====================================================

      await new Promise((resolve) => {
        stream.on("finish", resolve);
      });

      // =====================================================
      // IMPRIMIR WINDOWS
      // =====================================================

      console.log(`[PRINT] Enviando para impressora: ${this.printerName}`);

      await print(filePath, {
        printer: this.printerName,
      });

      console.log("[PRINT] Impressão enviada com sucesso!");

      return true;
    } catch (err) {
      console.error("[PRINT_ERROR]", err);

      throw err;
    }
  }
}

module.exports = EpsonPrinterService;
