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

  async connectToPrinter(printersList) {
    // Recebe a lista direto
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

      console.log(
        "[PRINTER] Lista de verificação recebida, tamanho:",
        printers.length,
      );

      const printerExists = printers.find((p) => p.name === this.printerName);

      if (!printerExists) {
        console.log(
          `[PRINTER] Impressora não encontrada no Windows: ${this.printerName}`,
        );
        this.isMock = true;
        this.isConnected = false;
        return { success: false, error: "Impressora não encontrada" };
      }

      console.log(
        `[PRINTER] Hardware validado com sucesso: ${this.printerName}`,
      );

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

  // =========================================================
  // FORMATAR PEDIDO (BLINDADO CONTRA UNDEFINED)
  // =========================================================

  formatarPedido(pedido) {
    // Reduzido para 38 para caber perfeitamente na largura de 226pt do PDFKit
    const LARGURA_MAX = 38;
    const linhas = [];

    const p = pedido || {};

    // ==========================================
    // CABEÇALHO PROFISSIONAL (DADOS DA EMPRESA)
    // ==========================================
    linhas.push(
      this._coluna("*** PRATINHO PRATUDO ***", LARGURA_MAX, "center"),
    );
    linhas.push(this._coluna("PRATINHO PRATUDO LTDA", LARGURA_MAX, "center"));
    linhas.push(
      this._coluna("CNPJ: 57.678.701/0001-00", LARGURA_MAX, "center"),
    );

    // Endereço do estabelecimento (quebrando em linhas dinamicamente caso seja longo)
    const enderecoEmpresa =
      "Rua Joaquim José da Silva, 1006, Vila Velha, Fortaleza - CE";
    linhas.push(
      ...this._ajustarTextoLongo(enderecoEmpresa, LARGURA_MAX, "", "center"),
    );

    linhas.push(
      this._coluna("Tel/Whats: (85) 99192-4340", LARGURA_MAX, "center"),
    );
    linhas.push("-".repeat(LARGURA_MAX));
    linhas.push(
      this._coluna("DOCUMENTO AUXILIAR DE VENDA", LARGURA_MAX, "center"),
    );
    linhas.push(this._coluna("CUPOM NÃO FISCAL", LARGURA_MAX, "center"));
    linhas.push("-".repeat(LARGURA_MAX));

    // Identificação do Pedido
    linhas.push(
      this._coluna(
        `PEDIDO ID: ${p.id || p._id || "0000"}`,
        LARGURA_MAX,
        "center",
      ),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    // CLIENTE
    linhas.push("CLIENTE:");
    linhas.push(this._coluna(p.cliente?.nome || "Não informado", LARGURA_MAX));
    if (p.cliente?.telefone) {
      linhas.push(this._coluna(`Tel: ${p.cliente.telefone}`, LARGURA_MAX));
    }
    linhas.push("-".repeat(LARGURA_MAX));

    // ITENS
    linhas.push("ITENS:");
    linhas.push("-".repeat(LARGURA_MAX));

    const itens = Array.isArray(p.itens) ? p.itens : [];

    if (itens.length === 0) {
      linhas.push(this._coluna("(Nenhum item encontrado)", LARGURA_MAX));
    }

    itens.forEach((item) => {
      // Ajuste de colunas para somar exatamente 38 caracteres:
      // Nome (18) + Qtd (4) + Preço (8) + Total (8) = 38
      const nomeItem = String(
        item?.name || item?.nome || "ITEM SEM NOME",
      ).toUpperCase();
      const nome = this._coluna(nomeItem, 18);
      const qtd = this._coluna(
        `x${item?.quantity || item?.qtd || 1}`,
        4,
        "right",
      );

      const precoNum = Number(item?.unitPrice || item?.preco || 0);
      const preco = this._coluna(precoNum.toFixed(2), 8, "right");

      const totalNum = precoNum * Number(item?.quantity || item?.qtd || 1);
      const total = this._coluna(totalNum.toFixed(2), 8, "right");

      linhas.push(`${nome}${qtd}${preco}${total}`);

      // EXTRAS
      if (item?.extras && item.extras.length > 0) {
        const textoExtras = item.extras.join(", ");
        linhas.push(
          ...this._ajustarTextoLongo(textoExtras, LARGURA_MAX, "  + "),
        );
      }

      // OBS
      if (item?.notes && item.notes.trim() !== "") {
        linhas.push(
          ...this._ajustarTextoLongo(item.notes, LARGURA_MAX, "  OBS: "),
        );
      }
      if (item?.observacao && item.observacao.trim() !== "") {
        linhas.push(
          ...this._ajustarTextoLongo(item.observacao, LARGURA_MAX, "  OBS: "),
        );
      }
    });

    linhas.push("-".repeat(LARGURA_MAX));

    // ENTREGA
    if (p.entrega) {
      linhas.push("ENTREGA:");
      if (p.entrega.tipo === "DELIVERY") {
        linhas.push("Tipo: Delivery");
        const endereco =
          p.entrega.endereco || p.cliente?.endereco || "Não informado";
        linhas.push(...this._ajustarTextoLongo(endereco, LARGURA_MAX, "End: "));
      }
      if (p.entrega.tipo === "PICKUP") {
        linhas.push("Tipo: Retirada");
      }
      if (p.entrega.tipo === "DINE_IN") {
        linhas.push(`Mesa: ${p.entrega.mesa || "Não informada"}`);
      }
      linhas.push("-".repeat(LARGURA_MAX));
    }

    // PAGAMENTO
    if (p.pagamento) {
      linhas.push("PAGAMENTO:");
      linhas.push(
        `${p.pagamento.metodo || "Não informado"} (${p.pagamento.status || "PENDENTE"})`,
      );

      if (p.pagamento.trocoPara) {
        linhas.push(
          `Troco para: R$ ${Number(p.pagamento.trocoPara).toFixed(2)}`,
        );
      }
      linhas.push("-".repeat(LARGURA_MAX));

      const totalPedido = Number(p.pagamento.total || p.total || 0);
      linhas.push(
        this._coluna(
          `TOTAL: R$ ${totalPedido.toFixed(2)}`,
          LARGURA_MAX,
          "right",
        ),
      );
    }

    linhas.push("-".repeat(LARGURA_MAX));

    const dataCriacao = p.createdAt ? new Date(p.createdAt) : new Date();
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

  // =========================================================
  // IMPRIMIR (CORRIGIDO E ISOLADO PARA MAC/WINDOWS)
  // =========================================================

  async imprimir(pedido) {
    try {
      const linhas = this.formatarPedido(pedido);

      // =====================================================
      // MOCK (RETORNA AS LINHAS PARA O BACKEND ENVIAR PRO HTML)
      // =====================================================
      if (this.isMock || !this.printerName) {
        console.log("\n🧪 ===== MOCK IMPRESSÃO (ENVIANDO PRO HTML) =====");
        return {
          success: true,
          mock: true,
          linhas: linhas,
        };
      }

      // =====================================================
      // WINDOWS SPOOLER - PREPARAÇÃO DO ARQUIVO
      // =====================================================

      const tempDir = require("os").tmpdir();
      const filePath = require("path").join(
        tempDir,
        `pedido-${Date.now()}.pdf`,
      );

      // Calculamos uma altura dinâmica baseada nas linhas reais do pedido
      const alturaCalculada = Math.max(300, linhas.length * 12 + 40);

      const doc = new PDFDocument({
        margin: 5,
        size: [226, alturaCalculada],
      });

      const stream = require("fs").createWriteStream(filePath);
      doc.pipe(stream);

      // Fonte monoespaçada para garantir o alinhamento das colunas no papel
      doc.font("Courier").fontSize(8.5);

      linhas.forEach((linha) => {
        const linhaLimpa = linha.replace(/\n/g, "");
        doc.text(linhaLimpa);
      });

      doc.end();

      // Aguardar o PDF concluir a escrita em disco
      await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      // =====================================================
      // INTERCEPTADOR DE SISTEMA OPERACIONAL (MUITO CRUCIAL)
      // =====================================================
      // Evita que a biblioteca 'pdf-to-printer' rode no Mac e estoure erro.
      if (process.platform === "darwin") {
        console.log(
          `[PRINT_MAC_OS] Sucesso! PDF de cupom gerado em: ${filePath}`,
        );
        return { success: true };
      }

      // =====================================================
      // IMPRESSÃO FÍSICA (SÓ VAI RODAR NO WINDOWS DO CLIENTE)
      // =====================================================
      console.log(
        `[PRINT] Enviando para impressora do Windows: ${this.printerName}`,
      );

      try {
        // Tentativa 1: Envia com configurações de redimensionamento para bobina térmica
        await print(filePath, {
          printer: this.printerName,
          options: ["-print-settings", "noscale,shrink"],
        });
      } catch (printError) {
        console.warn(
          "[PRINT_WARN] Driver do cliente rejeitou parâmetros. Tentando envio bruto...",
          printError,
        );

        // Tentativa 2 (Fallback): Se o driver antigo dele falhar com argumentos, envia o PDF cru
        await print(filePath, {
          printer: this.printerName,
        });
      }

      console.log("[PRINT] Impressão enviada com sucesso ao spooler!");
      return { success: true };
    } catch (err) {
      console.error("[PRINT_ERROR]", err);
      throw err;
    }
  }
}

module.exports = EpsonPrinterService;
