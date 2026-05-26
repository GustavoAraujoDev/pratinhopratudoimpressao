const escpos = require("escpos");
escpos.USB = require("escpos-usb");

const PDFDocument = require("pdfkit");
const { print } = require("pdf-to-printer");

const path = require("path");
const fs = require("fs");

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
  // FORMATAR PEDIDO (ENTREGA ABAIXO DO CLIENTE)
  // =========================================================
  formatarPedido(pedido) {
    const LARGURA_MAX = 38;
    const linhas = [];
    const p = pedido || {};

    linhas.push(
      this._coluna("*** PRATINHO PRATUDO ***", LARGURA_MAX, "center"),
    );
    linhas.push(this._coluna("PRATINHO PRATUDO LTDA", LARGURA_MAX, "center"));
    linhas.push(
      this._coluna("CNPJ: 57.678.701/0001-00", LARGURA_MAX, "center"),
    );

    const enderecoEmpresa =
      "Rua Joaquim José da Silva, 1006, Vila Velha, Fortaleza - CE";
    linhas.push(...this._ajustarTextoLongo(enderecoEmpresa, LARGURA_MAX, ""));

    linhas.push(
      this._coluna("Tel/Whats: (85) 99192-4340", LARGURA_MAX, "center"),
    );
    linhas.push("-".repeat(LARGURA_MAX));
    linhas.push(
      this._coluna("DOCUMENTO AUXILIAR DE VENDA", LARGURA_MAX, "center"),
    );
    linhas.push(this._coluna("CUPOM NÃO FISCAL", LARGURA_MAX, "center"));
    linhas.push("-".repeat(LARGURA_MAX));

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

    // 🔥 MOVIMENTADO: Bloco de Entrega com Endereço agora fica logo abaixo do Cliente
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

    // ITENS
    linhas.push("ITENS:");
    linhas.push("-".repeat(LARGURA_MAX));

    const itens = Array.isArray(p.itens) ? p.itens : [];
    if (itens.length === 0) {
      linhas.push(this._coluna("(Nenhum item encontrado)", LARGURA_MAX));
    }

    itens.forEach((item) => {
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

      if (item?.extras && item.extras.length > 0) {
        const textoExtras = item.extras.join(", ");
        linhas.push(
          ...this._ajustarTextoLongo(textoExtras, LARGURA_MAX, "  + "),
        );
      }

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

    // PAGAMENTO
    if (p.pagamento) {
      linhas.push("PAGAMENTO:");
      linhas.push(
        `${p.pagamento.metodo || "Não informado"} (${p.pagamento.status || "PENDENTE"})`,
      );

    // 💰 LOGICA DO TROCO INTEGRADA PARA A IMPRESSÃO IMPRESSA
      if (p.pagamento.metodo === "CASH" && p.pagamento.trocoPara) {
        const pagoCom = Number(p.pagamento.trocoPara);
        const valorTroco = pagoCom - Number(p.pagamento.total || p.total || 0);

        if (valorTroco > 0) {
          linhas.push(`Pago com: R$ ${pagoCom.toFixed(2)}`);
          linhas.push(`Troco: R$ ${valorTroco.toFixed(2)}`);
        } else {
          linhas.push(`Pago com: Valor exato`);
        }
      }

      if (
        p.entrega?.tipo === "DELIVERY" &&
        p.entrega?.taxaEntrega !== undefined
      ) {
        const taxaNum = Number(p.entrega.taxaEntrega || 0);
        linhas.push(
          this._coluna(
            `TAXA ENTREGA: R$ ${taxaNum.toFixed(2)}`,
            LARGURA_MAX,
            "right",
          ),
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

    return linhas;
  }

  async testPrint() {
    const pedidoTeste = {
      id: "9999",
      cliente: { nome: "CLIENTE TESTE", telefone: "(85) 99999-9999" },
      itens: [
        {
          name: "X-BACON",
          quantity: 2,
          unitPrice: 25,
          extras: ["CHEDDAR", "OVO"],
          notes: "Sem cebola",
        },
      ],
      pagamento: { total: 53, metodo: "PIX", status: "PAGO" },
      entrega: { tipo: "DELIVERY", endereco: "Rua Teste 123", taxaEntrega: 3 },
      createdAt: new Date().toISOString(),
    };
    return this.imprimir(pedidoTeste);
  }

  // =========================================================
  // IMPRIMIR (CORRIGIDO: FORÇA PÁGINA ÚNICA SEM QUEBRA)
  // =========================================================
  async imprimir(pedido) {
    try {
      const linhas = this.formatarPedido(pedido);

      if (this.isMock || !this.printerName) {
        console.log("\n🧪 ===== MOCK IMPRESSÃO (ENVIANDO PRO HTML) =====");
        return { success: true, mock: true, linhas: linhas };
      }

      const tempDir = require("os").tmpdir();
      const filePath = path.join(tempDir, `pedido-${Date.now()}.pdf`);

      const logoPath = path.join(__dirname, "logo.png");
      const temLogo = fs.existsSync(logoPath);

      const espacoLogo = temLogo ? 75 : 0;

      // 🔥 CORREÇÃO DA ALTURA: Aumentamos ligeiramente o multiplicador por linha (de 10 para 12)
      // e adicionamos uma margem de segurança de 30px no final para o papel respirar antes do corte.
      const alturaCalculada = linhas.length * 12 + espacoLogo + 30;

      const doc = new PDFDocument({
        margin: 0,
        size: [226, alturaCalculada],
        autoFirstPage: false, // 🔥 IMPEDE O PDFKIT DE CRIAR PÁGINAS AUTOMÁTICAS
      });

      // Criamos a página manualmente vinculada ao tamanho exato calculado
      doc.addPage({ margin: 0, size: [226, alturaCalculada] });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // 1. RENDERIZAR LOGO (Se o arquivo existir)
      let inicioTextoY = 2;
      if (temLogo) {
        doc.image(logoPath, (226 - 70) / 2, 2, { width: 70 });
        inicioTextoY = 75; // Garante que o texto comece bem abaixo da logo
      }

      // 2. RENDERIZAR TEXTOS DO CUPOM (Tudo em Courier-Bold)
      doc.font("Courier-Bold").fontSize(8.5);

      let primeiraLinha = true;
      linhas.forEach((linha) => {
        const linhaLimpa = linha.replace(/\n/g, "");

        if (primeiraLinha) {
          doc.text(linhaLimpa, 5, inicioTextoY, { lineGap: 1.5 });
          primeiraLinha = false;
        } else {
          doc.text(linhaLimpa, 5, doc.y, { lineGap: 1.5 });
        }
      });

      doc.end();

      await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      if (process.platform === "darwin") {
        console.log(
          `[PRINT_MAC_OS] Sucesso! PDF de cupom gerado em: ${filePath}`,
        );
        return { success: true };
      }

      console.log(
        `[PRINT] Enviando para impressora do Windows: ${this.printerName}`,
      );

      try {
        // "nosplit" diz ao Windows: "Não quebre isso em duas páginas de jeito nenhum!"
        await print(filePath, {
          printer: this.printerName,
          options: ["-print-settings", "noscale,nosplit,monochrome"],
        });
      } catch (printError) {
        console.warn(
          "[PRINT_WARN] Falha nos parâmetros avançados. Usando envio limpo...",
          printError,
        );
        await print(filePath, { printer: this.printerName });
      }

      console.log("[PRINT] Impressão enviada com sucesso ao spooler!");
      return { success: true };
    } catch (err) {
      console.error("[PRINT_ERROR]", err);
      throw err;
    }
  }

  // =========================================================
  // FORMATAR PARCIAL DA MESA (NOVO)
  // =========================================================
  formatarParcial(dados) {
    const LARGURA_MAX = 38;
    const linhas = [];
    const d = dados || {};
    const p = d.dadosComanda || {}; // Resgata o payload seguro vindo da API

    linhas.push(
      this._coluna("*** PRATINHO PRATUDO ***", LARGURA_MAX, "center"),
    );
    linhas.push(this._coluna("PRATINHO PRATUDO LTDA", LARGURA_MAX, "center"));
    linhas.push(
      this._coluna("CNPJ: 57.678.701/0001-00", LARGURA_MAX, "center"),
    );

    const enderecoEmpresa =
      "Rua Joaquim José da Silva, 1006, Vila Velha, Fortaleza - CE";
    linhas.push(...this._ajustarTextoLongo(enderecoEmpresa, LARGURA_MAX, ""));

    linhas.push(
      this._coluna("Tel/Whats: (85) 99192-4340", LARGURA_MAX, "center"),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    // Alerta visual destacado para o cliente saber que é apenas conferência
    linhas.push(this._coluna("CONFERENCIA DE CONSUMO", LARGURA_MAX, "center"));
    linhas.push(this._coluna("*** CONTA PARCIAL ***", LARGURA_MAX, "center"));
    linhas.push("-".repeat(LARGURA_MAX));

    // Identificação direta da Mesa afetada
    linhas.push(
      this._coluna(
        `MESA ATIVA: ${d.mesaId || "Não Informada"}`,
        LARGURA_MAX,
        "center",
      ),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    // OPERADOR/ATENDENTE (Auditoria)
    if (p.userId) {
      linhas.push(`ATENDENTE ID: ${p.userId}`);
      linhas.push("-".repeat(LARGURA_MAX));
    }

    // ITENS CONSUMIDOS ATÉ O MOMENTO
    linhas.push("ITENS CONSUMIDOS:");
    linhas.push("-".repeat(LARGURA_MAX));

    const itens = Array.isArray(p.itens) ? p.itens : [];
    if (itens.length === 0) {
      linhas.push(this._coluna("(Nenhum item na comanda)", LARGURA_MAX));
    }

    itens.forEach((item) => {
      const nomeItem = String(
        item?.name || item?.nome || "ITEM SEM NOME",
      ).toUpperCase();
      const nome = this._coluna(nomeItem, 18);
      const qtd = this._coluna(
        `x${item?.quantity || item?.qty || 1}`,
        4,
        "right",
      );
      const precoNum = Number(item?.unitPrice || item?.preco || 0);
      const preco = this._coluna(precoNum.toFixed(2), 8, "right");
      const totalNum = precoNum * Number(item?.quantity || item?.qtd || 1);
      const total = this._coluna(totalNum.toFixed(2), 8, "right");

      linhas.push(`${nome}${qtd}${preco}${total}`);

      if (item?.extras && item.extras.length > 0) {
        const textoExtras = item.extras.join(", ");
        linhas.push(
          ...this._ajustarTextoLongo(textoExtras, LARGURA_MAX, "  + "),
        );
      }

      if (item?.notes && item.notes.trim() !== "") {
        linhas.push(
          ...this._ajustarTextoLongo(item.notes, LARGURA_MAX, "  OBS: "),
        );
      }
    });

    linhas.push("-".repeat(LARGURA_MAX));

    // SUB-TOTAL ACUMULADO
    if (p.pagamento) {
      const subTotalAcumulado = Number(p.pagamento.total || p.total || 0);
      linhas.push(
        this._coluna(
          `SUB-TOTAL: R$ ${subTotalAcumulado.toFixed(2)}`,
          LARGURA_MAX,
          "right",
        ),
      );
    }

    linhas.push("-".repeat(LARGURA_MAX));

    // Mensagem informativa no rodapé
    linhas.push(
      this._coluna("* MESA CONTINUA EM ATENDIMENTO *", LARGURA_MAX, "center"),
    );
    linhas.push(
      this._coluna("DOCUMENTO SEM VALOR FISCAL", LARGURA_MAX, "center"),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    const dataImpressao = new Date();
    linhas.push(
      this._coluna(
        `Impresso em: ${dataImpressao.toLocaleString("pt-BR")}`,
        LARGURA_MAX,
      ),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    return linhas;
  }

  // =========================================================
  // IMPRIMIR PARCIAL DA MESA (CORRIGIDO)
  // =========================================================
  async imprimirParcial(dadosParcial) {
    try {
      const linhas = this.formatarParcial(dadosParcial);

      // Se estiver em modo simulado/mock, desvia enviando o array para renderização em tela
      if (this.isMock || !this.printerName) {
        console.log(
          "\n🧪 ===== MOCK IMPRESSÃO PARCIAL (ENVIANDO PRO HTML) =====",
        );
        return { success: true, mock: true, linhas: linhas };
      }

      const tempDir = require("os").tmpdir();
      const filePath = path.join(
        tempDir,
        `parcial-${dadosParcial.mesaId || "mesa"}-${Date.now()}.pdf`,
      );

      const logoPath = path.join(__dirname, "logo.png");
      const temLogo = fs.existsSync(logoPath);
      const espacoLogo = temLogo ? 75 : 0;

      // Mantém a exata consistência matemática de cálculo de altura do seu motor de PDF
      const alturaCalculada = linhas.length * 12 + espacoLogo + 30;

      const doc = new PDFDocument({
        margin: 0,
        size: [226, alturaCalculada],
        autoFirstPage: false,
      });

      doc.addPage({ margin: 0, size: [226, alturaCalculada] });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      let inicioTextoY = 2;
      if (temLogo) {
        doc.image(logoPath, (226 - 70) / 2, 2, { width: 70 });
        inicioTextoY = 75;
      }

      doc.font("Courier-Bold").fontSize(8.5);

      let primeiraLinha = true;
      linhas.forEach((linha) => {
        // ✅ CORRIGIDO: Atribuição limpa e segura da string para o PDFKit
        const linhaLimpa = String(linha || "").replace(/\n/g, "");

        if (primeiraLinha) {
          doc.text(linhaLimpa, 5, inicioTextoY, { lineGap: 1.5 });
          primeiraLinha = false;
        } else {
          doc.text(linhaLimpa, 5, doc.y, { lineGap: 1.5 });
        }
      });

      doc.end();

      await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      if (process.platform === "darwin") {
        console.log(
          `[PRINT_MAC_OS] Sucesso! PDF de parcial da comanda gerado em: ${filePath}`,
        );
        return { success: true };
      }

      console.log(
        `[PRINT_PARTIAL] Enviando para impressora do Windows: ${this.printerName}`,
      );

      try {
        const { print } = require("pdf-to-printer"); // Garante a dependência ativa
        await print(filePath, {
          printer: this.printerName,
          options: ["-print-settings", "noscale,nosplit,monochrome"],
        });
      } catch (printError) {
        console.warn(
          "[PRINT_WARN] Falha nos parâmetros avançados de parcial. Usando envio limpo...",
          printError,
        );
        const { print } = require("pdf-to-printer");
        await print(filePath, { printer: this.printerName });
      }

      console.log(
        "[PRINT_PARTIAL] Parcial de mesa enviada com sucesso ao spooler!",
      );
      return { success: true };
    } catch (err) {
      console.error("[PRINT_PARTIAL_ERROR]", err);
      throw err;
    }
  }

  // =========================================================
  // FORMATAR RECIBO DE ABATIMENTO EXCLUSIVO (NOVO)
  // =========================================================
  formatarReciboAbatimento(dados) {
    const LARGURA_MAX = 38;
    const linhas = [];
    const d = dados || {};
    const p = d.dadosComanda || {}; // Resgata o payload vindo do backend

    linhas.push(
      this._coluna("*** PRATINHO PRATUDO ***", LARGURA_MAX, "center"),
    );
    linhas.push(this._coluna("PRATINHO PRATUDO LTDA", LARGURA_MAX, "center"));
    linhas.push(
      this._coluna("CNPJ: 57.678.701/0001-00", LARGURA_MAX, "center"),
    );

    const enderecoEmpresa =
      "Rua Joaquim José da Silva, 1006, Vila Velha, Fortaleza - CE";
    linhas.push(...this._ajustarTextoLongo(enderecoEmpresa, LARGURA_MAX, ""));
    linhas.push(
      this._coluna("Tel/Whats: (85) 99192-4340", LARGURA_MAX, "center"),
    );

    linhas.push("-".repeat(LARGURA_MAX));
    linhas.push(
      this._coluna("COMPROVANTE DE PAGAMENTO", LARGURA_MAX, "center"),
    );
    linhas.push(
      this._coluna("--- ABATIMENTO PARCIAL ---", LARGURA_MAX, "center"),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    linhas.push(
      this._coluna(
        `MESA DE ORIGEM: ${d.mesaId || "Não Informada"}`,
        LARGURA_MAX,
      ),
    );
    if (p.userId) {
      linhas.push(this._coluna(`ATENDENTE ID: ${p.userId}`, LARGURA_MAX));
    }
    linhas.push("-".repeat(LARGURA_MAX));

    linhas.push("HISTÓRICO DO LANÇAMENTO:");
    linhas.push("-".repeat(LARGURA_MAX));

    const itens = Array.isArray(p.itens) ? p.itens : [];
    itens.forEach((item) => {
      const nomeItem = String(
        item?.name || item?.nome || "PAGAMENTO PARCIAL",
      ).toUpperCase();
      const nome = this._coluna(nomeItem, 20);
      const qtd = this._coluna(
        `x${item?.quantity || item?.qty || 1}`,
        4,
        "right",
      );

      const totalNum = Number(item?.total || item?.unitPrice || 0);
      const total = this._coluna(totalNum.toFixed(2), 14, "right");

      linhas.push(`${nome}${qtd}${total}`);
    });

    linhas.push("-".repeat(LARGURA_MAX));

    if (p.pagamento) {
      const valorPago = Number(p.pagamento.total || 0);
      linhas.push(
        this._coluna(
          `FORMA: ${p.pagamento.metodo || "NÃO INFORMADA"}`,
          LARGURA_MAX,
        ),
      );
      linhas.push(
        this._coluna(
          `STATUS: ${p.pagamento.status || "RECEBIDO"}`,
          LARGURA_MAX,
        ),
      );
      linhas.push("-".repeat(LARGURA_MAX));
      linhas.push(
        this._coluna(
          `VALOR ABATIDO: R$ ${valorPago.toFixed(2)}`,
          LARGURA_MAX,
          "right",
        ),
      );
    }

    linhas.push("-".repeat(LARGURA_MAX));
    linhas.push(
      this._coluna("* COMPROVANTE DO CLIENTE *", LARGURA_MAX, "center"),
    );
    linhas.push(
      this._coluna("A MESA CONTINUA EM ATENDIMENTO", LARGURA_MAX, "center"),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    const dataImpressao = new Date();
    linhas.push(
      this._coluna(
        `Impresso em: ${dataImpressao.toLocaleString("pt-BR")}`,
        LARGURA_MAX,
      ),
    );
    linhas.push("-".repeat(LARGURA_MAX));

    return linhas;
  }

  // =========================================================
  // IMPRIMIR RECIBO DE ABATIMENTO (NOVO)
  // =========================================================
  async imprimirReciboAbatimento(dadosRecibo) {
    try {
      const linhas = this.formatarReciboAbatimento(dadosRecibo);

      if (this.isMock || !this.printerName) {
        console.log("\n🧪 ===== MOCK IMPRESSÃO RECIBO ABATIMENTO (HTML) =====");
        return { success: true, mock: true, linhas: linhas };
      }

      const tempDir = require("os").tmpdir();
      const filePath = path.join(
        tempDir,
        `recibo-abatimento-${Date.now()}.pdf`,
      );

      const logoPath = path.join(__dirname, "logo.png");
      const temLogo = fs.existsSync(logoPath);
      const espacoLogo = temLogo ? 75 : 0;

      const alturaCalculada = linhas.length * 12 + espacoLogo + 30;

      const doc = new PDFDocument({
        margin: 0,
        size: [226, alturaCalculada],
        autoFirstPage: false,
      });

      doc.addPage({ margin: 0, size: [226, alturaCalculada] });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      let inicioTextoY = 2;
      if (temLogo) {
        doc.image(logoPath, (226 - 70) / 2, 2, { width: 70 });
        inicioTextoY = 75;
      }

      doc.font("Courier-Bold").fontSize(8.5);

      let primeiraLinha = true;
      linhas.forEach((linha) => {
        const linhaLimpa = String(linha || "").replace(/\n/g, "");

        if (primeiraLinha) {
          doc.text(linhaLimpa, 5, inicioTextoY, { lineGap: 1.5 });
          primeiraLinha = false;
        } else {
          doc.text(linhaLimpa, 5, doc.y, { lineGap: 1.5 });
        }
      });

      doc.end();

      await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      if (process.platform === "darwin") {
        console.log(
          `[PRINT_MAC_OS] Recibo de Abatimento gerado em: ${filePath}`,
        );
        return { success: true };
      }

      await print(filePath, {
        printer: this.printerName,
        options: ["-print-settings", "noscale,nosplit,monochrome"],
      });

      console.log(
        "[PRINT_RECIBO] Recibo de abatimento enviado com sucesso ao spooler!",
      );
      return { success: true };
    } catch (err) {
      console.error("[PRINT_RECIBO_ERROR]", err);
      throw err;
    }
  }
}

module.exports = EpsonPrinterService;
