// ==========================================
// POCOYO STORE - LOJA + SISTEMA DE TICKETS
// discord.js v14 | Node.js 18+
// ==========================================

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// CONFIGURAÇÕES
const TOKEN =
  process.env.DISCORD_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TOKEN;

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const PREFIX = process.env.PREFIX || "!";

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";
const STAFF_ROLE_ID =
  process.env.TICKET_STAFF_ROLE_ID ||
  ADMIN_ROLE_ID;

const TICKET_CATEGORY_ID =
  process.env.TICKET_CATEGORY_ID || "";

const ORDERS_CHANNEL_ID =
  process.env.ORDERS_CHANNEL_ID || "";

// VERIFICAÇÃO
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "ERRO: configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID."
  );
  process.exit(1);
}

// CLIENTE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// BANCO DE DADOS
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultDB() {
  return {
    products: [],
    orders: [],
    carts: {},
    coupons: [],
    tickets: [],
    nextProductId: 1,
    nextOrderId: 1001,

    ticketSettings: {
      title: "Central de Atendimento",
      description:
        "Bem-vindo à Pocoyo Store! Escolha uma opção abaixo para receber atendimento.",
      banner: ""
    }
  };
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const saved = JSON.parse(
        fs.readFileSync(DB_FILE, "utf8")
      );

      return {
        ...defaultDB(),
        ...saved,
        ticketSettings: {
          ...defaultDB().ticketSettings,
          ...(saved.ticketSettings || {})
        }
      };
    }
  } catch (error) {
    console.error("Erro ao carregar banco:", error);
  }

  return defaultDB();
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}

// FUNÇÕES AUXILIARES
function money(value) {
  return Number(value || 0).toLocaleString(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL"
    }
  );
}

function parsePrice(value) {
  const number = Number(
    String(value)
      .trim()
      .replace(/\./g, "")
      .replace(",", ".")
  );

  return Number.isFinite(number) && number >= 0
    ? number
    : null;
}

function isAdmin(member) {
  if (!member) return false;

  return (
    member.permissions?.has(
      PermissionFlagsBits.Administrator
    ) ||
    member.permissions?.has(
      PermissionFlagsBits.ManageGuild
    ) ||
    (
      ADMIN_ROLE_ID &&
      member.roles?.cache?.has(ADMIN_ROLE_ID)
    )
  );
}

function isStaff(member) {
  return (
    isAdmin(member) ||
    (
      STAFF_ROLE_ID &&
      member.roles?.cache?.has(STAFF_ROLE_ID)
    )
  );
}

function createEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x36B7F4)
    .setTitle(title)
    .setDescription(description || null)
    .setFooter({
      text: "Pocoyo Store • Pagamento e entrega manuais"
    })
    .setTimestamp();
}

// CARRINHO
function getCart(userId) {
  if (!db.carts[userId]) {
    db.carts[userId] = {
      items: [],
      coupon: null
    };
  }

  if (Array.isArray(db.carts[userId])) {
    db.carts[userId] = {
      items: db.carts[userId],
      coupon: null
    };
  }

  return db.carts[userId];
}

function getCartSubtotal(userId) {
  const cart = getCart(userId);

  return cart.items.reduce((total, item) => {
    const product = db.products.find(
      p => p.id === item.productId
    );

    return total + (
      product
        ? product.price * item.quantity
        : 0
    );
  }, 0);
}

function getCartTotals(userId) {
  const subtotal = getCartSubtotal(userId);
  const cart = getCart(userId);

  const coupon = db.coupons.find(
    c =>
      c.code === cart.coupon &&
      c.active
  );

  const discount = coupon
    ? subtotal * coupon.percent / 100
    : 0;

  return {
    subtotal,
    discount,
    total: Math.max(0, subtotal - discount),
    coupon
  };
}

// ==========================================
// PARTE 2 - COMANDOS SLASH E PAINÉIS
// ==========================================

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Publica o painel da loja"),

  new SlashCommandBuilder()
    .setName("catalogo")
    .setDescription("Mostra os produtos da loja"),

  new SlashCommandBuilder()
    .setName("carrinho")
    .setDescription("Mostra seu carrinho"),

  new SlashCommandBuilder()
    .setName("comprar")
    .setDescription("Finaliza seu pedido"),

  new SlashCommandBuilder()
    .setName("pedido")
    .setDescription("Consulta um pedido")
    .addIntegerOption(option =>
      option.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("adicionar")
    .setDescription("Adiciona um produto")
    .addStringOption(option =>
      option.setName("nome")
        .setDescription("Nome do produto")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("preco")
        .setDescription("Preço, exemplo 19,90")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("estoque")
        .setDescription("Quantidade disponível")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("descricao")
        .setDescription("Descrição do produto")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("estoque")
    .setDescription("Altera o estoque de um produto")
    .addIntegerOption(option =>
      option.setName("produto")
        .setDescription("ID do produto")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("quantidade")
        .setDescription("Novo estoque")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removerproduto")
    .setDescription("Remove um produto")
    .addIntegerOption(option =>
      option.setName("produto")
        .setDescription("ID do produto")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pedidos")
    .setDescription("Lista todos os pedidos"),

  new SlashCommandBuilder()
    .setName("pago")
    .setDescription("Confirma o pagamento de um pedido")
    .addIntegerOption(option =>
      option.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("entregar")
    .setDescription("Marca um pedido como entregue")
    .addIntegerOption(option =>
      option.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("detalhes")
        .setDescription("Informações da entrega")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("cancelar")
    .setDescription("Cancela um pedido")
    .addIntegerOption(option =>
      option.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    ),

  // CUPOM ADM — NOME TODO MINÚSCULO
  new SlashCommandBuilder()
    .setName("cupomadm")
    .setDescription("Cria ou atualiza um cupom")
    .addStringOption(option =>
      option.setName("codigo")
        .setDescription("Código do cupom")
        .setRequired(true)
    )
    .addNumberOption(option =>
      option.setName("porcentagem")
        .setDescription("Desconto de 1 a 100 por cento")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticketpainel")
    .setDescription("Publica o painel de tickets"),

  new SlashCommandBuilder()
    .setName("ticketconfig")
    .setDescription("Personaliza o painel de tickets")
    .addStringOption(option =>
      option.setName("titulo")
        .setDescription("Título do painel")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("descricao")
        .setDescription("Descrição do painel")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticketbanner")
    .setDescription("Altera a imagem do painel de tickets")
    .addStringOption(option =>
      option.setName("url")
        .setDescription("Link direto da imagem")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticketreset")
    .setDescription("Restaura o painel de tickets")
].map(command => command.toJSON());

// REGISTRAR COMANDOS
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Comandos slash registrados!");
}

// PAINEL DA LOJA
function storePanel() {
  return {
    embeds: [
      createEmbed(
        "💙 POCOYO STORE",
        "Bem-vindo à nossa loja!\n\nUse `!help` para conhecer os comandos disponíveis.\n\n🛒 Confira nosso catálogo e faça seu pedido!"
      )
    ]
  };
}

// CATÁLOGO
function catalogPanel() {
  const embed = createEmbed(
    "📦 CATÁLOGO — POCOYO STORE",
    "Confira os produtos disponíveis:"
  );

  if (db.products.length === 0) {
    embed.setDescription("Ainda não existem produtos cadastrados.");
    return { embeds: [embed] };
  }

  embed.setDescription(
    db.products.map(product =>
      `**${product.id} — ${product.name}**\n` +
      `${product.description || "Sem descrição"}\n` +
      `💰 Preço: **${money(product.price)}**\n` +
      `📦 Estoque: **${product.stock}**`
    ).join("\n\n")
  );

  return { embeds: [embed] };
}

// PAINEL DE TICKETS
function ticketPanel() {
  const settings = db.ticketSettings;

  const embed = createEmbed(
    settings.title,
    settings.description
  );

  if (settings.banner) {
    embed.setImage(settings.banner);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_buy")
      .setLabel("Comprar Produtos")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket_support")
      .setLabel("Suporte")
      .setEmoji("🛟")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_staff")
      .setLabel("Fale com a Equipe")
      .setEmoji("💬")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

// AJUDA DOS CLIENTES
function customerHelp() {
  return createEmbed(
    "💙 POCOYO STORE — COMANDOS",
    [
      `\`${PREFIX}help\` — Mostra esta ajuda`,
      `\`${PREFIX}pocoyo\` — Abre a ajuda`,
      `\`${PREFIX}catalogo\` — Mostra os produtos`,
      `\`${PREFIX}carrinho\` — Mostra seu carrinho`,
      `\`${PREFIX}comprar\` — Finaliza seu pedido`,
      `\`${PREFIX}pedido NUMERO\` — Consulta seu pedido`,
      `\`${PREFIX}cupom\` — Mostra os cupons`,
      `\`${PREFIX}cupom CODIGO\` — Aplica um cupom`,
      `\`${PREFIX}calculadora VALOR PORCENTAGEM\` — Calcula desconto`
    ].join("\n")
  );
}

// ==========================================
// PARTE 3 - LOJA, CARRINHO E PEDIDOS
// ==========================================

// ADICIONAR PRODUTO
function addProduct(name, priceText, stock, description = "") {
  const price = parsePrice(priceText);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Preço inválido. Exemplo: 19,90");
  }

  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error("Estoque inválido.");
  }

  const product = {
    id: db.nextProductId++,
    name,
    price,
    stock,
    description
  };

  db.products.push(product);
  saveDB();

  return product;
}

// ADICIONAR AO CARRINHO
function addToCart(userId, productId, quantity = 1) {
  const product = db.products.find(p => p.id === productId);

  if (!product) {
    throw new Error("Produto não encontrado.");
  }

  if (quantity < 1 || product.stock < quantity) {
    throw new Error("Estoque insuficiente.");
  }

  const cart = getCart(userId);
  const item = cart.items.find(i => i.productId === productId);

  const currentQuantity = item ? item.quantity : 0;

  if (currentQuantity + quantity > product.stock) {
    throw new Error("Não há estoque suficiente.");
  }

  if (item) {
    item.quantity += quantity;
  } else {
    cart.items.push({
      productId,
      quantity
    });
  }

  saveDB();
}

// TEXTO DO CARRINHO
function cartEmbed(userId) {
  const cart = getCart(userId);
  const totals = getCartTotals(userId);

  const embed = createEmbed(
    "🛒 SEU CARRINHO",
    ""
  );

  if (!cart.items.length) {
    embed.setDescription("Seu carrinho está vazio.");
    return embed;
  }

  const lines = cart.items.map(item => {
    const product = db.products.find(
      p => p.id === item.productId
    );

    if (!product) return null;

    return (
      `**${product.name}**\n` +
      `Quantidade: ${item.quantity}\n` +
      `Preço: ${money(product.price * item.quantity)}`
    );
  }).filter(Boolean);

  lines.push(
    "",
    `Subtotal: **${money(totals.subtotal)}**`,
    `Desconto: **${money(totals.discount)}**`,
    `Total: **${money(totals.total)}**`
  );

  if (totals.coupon) {
    lines.push(`Cupom aplicado: **${totals.coupon.code}**`);
  }

  embed.setDescription(lines.join("\n"));

  return embed;
}

// FINALIZAR PEDIDO
function createOrder(userId) {
  const cart = getCart(userId);

  if (!cart.items.length) {
    throw new Error("Seu carrinho está vazio.");
  }

  for (const item of cart.items) {
    const product = db.products.find(
      p => p.id === item.productId
    );

    if (!product || product.stock < item.quantity) {
      throw new Error("Um produto está sem estoque suficiente.");
    }
  }

  const totals = getCartTotals(userId);

  const order = {
    id: db.nextOrderId++,
    userId,
    items: cart.items.map(item => {
      const product = db.products.find(
        p => p.id === item.productId
      );

      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: item.quantity
      };
    }),
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    coupon: totals.coupon ? totals.coupon.code : null,
    status: "Aguardando pagamento",
    createdAt: new Date().toISOString(),
    delivery: null
  };

  for (const item of cart.items) {
    const product = db.products.find(
      p => p.id === item.productId
    );

    product.stock -= item.quantity;
  }

  db.orders.push(order);

  cart.items = [];
  cart.coupon = null;

  saveDB();

  return order;
}

// CONSULTAR PEDIDO
function findOrder(orderId) {
  return db.orders.find(order => order.id === orderId);
}

// EMBED DO PEDIDO
function orderEmbed(order) {
  const embed = createEmbed(
    `📦 PEDIDO #${order.id}`,
    ""
  );

  embed.addFields(
    {
      name: "Status",
      value: order.status,
      inline: true
    },
    {
      name: "Total",
      value: money(order.total),
      inline: true
    },
    {
      name: "Produtos",
      value: order.items.map(item =>
        `${item.name} x${item.quantity}`
      ).join("\n").slice(0, 1024)
    }
  );

  if (order.coupon) {
    embed.addFields({
      name: "Cupom",
      value: order.coupon,
      inline: true
    });
  }

  if (order.delivery) {
    embed.addFields({
      name: "Entrega",
      value: order.delivery.slice(0, 1024)
    });
  }

  return embed;
}

// AVISAR CANAL DA EQUIPE
async function notifyOrder(order) {
  if (!ORDERS_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(
      ORDERS_CHANNEL_ID
    );

    if (channel) {
      await channel.send({
        content: `🛒 Novo pedido de <@${order.userId}>!`,
        embeds: [orderEmbed(order)]
      });
    }
  } catch (error) {
    console.error("Erro ao avisar pedido:", error);
  }
}

// CRIAR CUPOM
function createCoupon(code, percent) {
  const cleanCode = code.trim().toUpperCase();

  if (!cleanCode || !Number.isFinite(percent) ||
      percent < 1 || percent > 100) {
    throw new Error("Código ou porcentagem inválidos.");
  }

  let coupon = db.coupons.find(
    c => c.code === cleanCode
  );

  if (coupon) {
    coupon.percent = percent;
    coupon.active = true;
  } else {
    coupon = {
      code: cleanCode,
      percent,
      active: true
    };

    db.coupons.push(coupon);
  }

  saveDB();
  return coupon;
}

// APLICAR CUPOM
function applyCoupon(userId, code) {
  const cleanCode = code.trim().toUpperCase();

  const coupon = db.coupons.find(
    c => c.code === cleanCode && c.active
  );

  if (!coupon) {
    throw new Error("Cupom não encontrado ou inativo.");
  }

  const cart = getCart(userId);

  if (!cart.items.length) {
    throw new Error("Adicione produtos ao carrinho primeiro.");
  }

  cart.coupon = coupon.code;
  saveDB();

  return coupon;
}

// LISTAR CUPONS
function couponEmbed() {
  const embed = createEmbed(
    "🎟️ CUPONS DISPONÍVEIS",
    ""
  );

  const activeCoupons = db.coupons.filter(
    coupon => coupon.active
  );

  if (!activeCoupons.length) {
    embed.setDescription("Nenhum cupom disponível no momento.");
    return embed;
  }

  embed.setDescription(
    activeCoupons.map(coupon =>
      `🎟️ **${coupon.code}** — ${coupon.percent}% de desconto`
    ).join("\n")
  );

  return embed;
}

// ==========================================
// PARTE 4 - SISTEMA DE TICKETS
// ==========================================

// CRIAR CANAL PRIVADO DE TICKET
async function createTicket(interaction, type, details) {
  const guild = interaction.guild;

  if (!guild) {
    throw new Error("Este recurso só funciona dentro de um servidor.");
  }

  const existing = db.tickets.find(
    ticket =>
      ticket.userId === interaction.user.id &&
      ticket.status === "aberto"
  );

  if (existing) {
    const channel = guild.channels.cache.get(existing.channelId);

    if (channel) {
      throw new Error(
        `Você já possui um ticket aberto: ${channel}`
      );
    }

    existing.status = "fechado";
  }

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    }
  ];

  if (STAFF_ROLE_ID) {
    permissionOverwrites.push({
      id: STAFF_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  const channelOptions = {
    name: `ticket-${interaction.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 80),
    type: ChannelType.GuildText,
    permissionOverwrites
  };

  if (TICKET_CATEGORY_ID) {
    const category = guild.channels.cache.get(TICKET_CATEGORY_ID);

    if (category && category.type === ChannelType.GuildCategory) {
      channelOptions.parent = category.id;
    }
  }

  const ticketChannel = await guild.channels.create(channelOptions);

  const ticket = {
    userId: interaction.user.id,
    channelId: ticketChannel.id,
    type,
    details,
    status: "aberto",
    createdAt: new Date().toISOString()
  };

  db.tickets.push(ticket);
  saveDB();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Fechar Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  const ticketEmbed = createEmbed(
    `🎫 TICKET — ${type}`,
    `Olá, ${interaction.user}!\n\n` +
    `**Informações enviadas:**\n${details}\n\n` +
    "A equipe responderá assim que possível."
  );

  await ticketChannel.send({
    content: `${interaction.user}` +
      (STAFF_ROLE_ID ? ` <@&${STAFF_ROLE_ID}>` : ""),
    embeds: [ticketEmbed],
    components: [closeRow]
  });

  return ticketChannel;
}

// MODAL DE TICKET
function ticketModal(type) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${type}`)
    .setTitle("Abrir Ticket");

  const input = new TextInputBuilder()
    .setCustomId("ticket_details")
    .setLabel("Como podemos ajudar?")
    .setPlaceholder("Escreva os detalhes do seu atendimento...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(input)
  );

  return modal;
}

// FECHAR TICKET
async function closeTicket(interaction) {
  const ticket = db.tickets.find(
    t =>
      t.channelId === interaction.channel.id &&
      t.status === "aberto"
  );

  if (!ticket) {
    return interaction.reply({
      content: "Este canal não é um ticket aberto.",
      ephemeral: true
    });
  }

  if (
    interaction.user.id !== ticket.userId &&
    !isStaff(interaction.member)
  ) {
    return interaction.reply({
      content: "Somente o dono do ticket ou a equipe pode fechá-lo.",
      ephemeral: true
    });
  }

  ticket.status = "fechado";
  ticket.closedAt = new Date().toISOString();
  saveDB();

  await interaction.reply({
    content: "🔒 Ticket fechado. Este canal será apagado em alguns segundos."
  });

  setTimeout(async () => {
    try {
      await interaction.channel.delete("Ticket fechado");
    } catch (error) {
      console.error("Não foi possível apagar o ticket:", error);
    }
  }, 5000);
}

// PERSONALIZAR PAINEL
function updateTicketSettings(title, description) {
  db.ticketSettings.title = title;
  db.ticketSettings.description = description;
  saveDB();
}

function updateTicketBanner(url) {
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    throw new Error("Informe um link válido para a imagem.");
  }

  db.ticketSettings.banner = url;
  saveDB();
}

// CALCULADORA DE DESCONTO
function calculateDiscount(value, percent) {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(percent) ||
    value < 0 ||
    percent < 0 ||
    percent > 100
  ) {
    throw new Error("Informe valores válidos.");
  }

  const discount = value * percent / 100;

  return {
    original: value,
    percent,
    discount,
    total: value - discount
  };
}

// ==========================================
// PARTE 5 - EVENTOS E INICIALIZAÇÃO
// ==========================================

// BOT ONLINE
client.once("ready", async () => {
  console.log(`Bot conectado como ${client.user.tag}`);

  try {
    await registerCommands();
    console.log("Todos os comandos foram registrados!");
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }
});

// COMANDOS DE TEXTO
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const lower = content.toLowerCase();

  if (!content.startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || "").toLowerCase();

  try {
    // AJUDA
    if (["help", "ajuda", "pocoyo"].includes(command)) {
      return message.reply({
        embeds: [customerHelp()]
      });
    }

    // CATÁLOGO
    if (["catalogo", "loja", "produtos"].includes(command)) {
      return message.reply(catalogPanel());
    }

    // CARRINHO
    if (["carrinho", "cart"].includes(command)) {
      return message.reply({
        embeds: [cartEmbed(message.author.id)]
      });
    }

    // COMPRAR
    if (command === "comprar") {
      const order = createOrder(message.author.id);

      await message.reply({
        content: `💙 Pedido **#${order.id}** criado!\n` +
          `Total: **${money(order.total)}**\n` +
          "A equipe confirmará seu pagamento manualmente.",
        embeds: [orderEmbed(order)]
      });

      await notifyOrder(order);
      return;
    }

    // CONSULTAR PEDIDO
    if (command === "pedido") {
      const id = Number(args[0]);
      const order = findOrder(id);

      if (!order || order.userId !== message.author.id) {
        return message.reply("Pedido não encontrado.");
      }

      return message.reply({
        embeds: [orderEmbed(order)]
      });
    }

    // CUPONS
    if (command === "cupom") {
      if (!args[0]) {
        return message.reply({
          embeds: [couponEmbed()]
        });
      }

      const coupon = applyCoupon(message.author.id, args[0]);

      return message.reply(
        `🎟️ Cupom **${coupon.code}** aplicado!\n` +
        `Desconto: **${coupon.percent}%**\n` +
        "Confira o novo total com `!carrinho`."
      );
    }

    // CALCULADORA
    if (command === "calculadora") {
      const value = parsePrice(args[0]);
      const percent = Number(
        String(args[1] || "").replace("%", "").replace(",", ".")
      );

      const result = calculateDiscount(value, percent);

      return message.reply(
        `🧮 **CALCULADORA POCOYO**\n\n` +
        `Valor original: ${money(result.original)}\n` +
        `Desconto: ${result.percent}%\n` +
        `Valor descontado: ${money(result.discount)}\n` +
        `**Total: ${money(result.total)}**`
      );
    }

    // COMANDOS DA EQUIPE
    if (command === "adicionar") {
      if (!isAdmin(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      const name = args[0];
      const price = args[1];
      const stock = Number(args[2]);
      const description = args.slice(3).join(" ");

      if (!name || !price || !Number.isInteger(stock)) {
        return message.reply(
          "Use: `!adicionar nome preco estoque descricao`"
        );
      }

      const product = addProduct(name, price, stock, description);

      return message.reply(
        `✅ Produto **${product.name}** cadastrado com ID ${product.id}.`
      );
    }

    if (command === "cupomadm") {
      if (!isAdmin(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      const coupon = createCoupon(args[0], Number(args[1]));

      return message.reply(
        `✅ Cupom **${coupon.code}** configurado com ${coupon.percent}% de desconto.`
      );
    }

    if (command === "estoque") {
      if (!isAdmin(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      const product = db.products.find(p => p.id === Number(args[0]));
      const quantity = Number(args[1]);

      if (!product || !Number.isInteger(quantity) || quantity < 0) {
        return message.reply("Use: `!estoque ID quantidade`");
      }

      product.stock = quantity;
      saveDB();

      return message.reply(
        `✅ Estoque de **${product.name}** atualizado para ${quantity}.`
      );
    }

    if (command === "removerproduto") {
      if (!isAdmin(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      const id = Number(args[0]);
      const index = db.products.findIndex(p => p.id === id);

      if (index === -1) {
        return message.reply("Produto não encontrado.");
      }

      const removed = db.products.splice(index, 1)[0];

      saveDB();

      return message.reply(
        `🗑️ Produto **${removed.name}** removido.`
      );
    }

    if (command === "pedidos") {
      if (!isStaff(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      if (!db.orders.length) {
        return message.reply("Ainda não existem pedidos.");
      }

      const description = db.orders.slice(-15).map(order =>
        `**#${order.id}** — ${money(order.total)} — ${order.status}`
      ).join("\n");

      return message.reply({
        embeds: [
          createEmbed("📦 PEDIDOS DA LOJA", description)
        ]
      });
    }

    if (command === "pago") {
      if (!isStaff(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      const order = findOrder(Number(args[0]));

      if (!order) {
        return message.reply("Pedido não encontrado.");
      }

      order.status = "Pagamento confirmado";
      saveDB();

      return message.reply({
        content: "✅ Pagamento confirmado!",
        embeds: [orderEmbed(order)]
      });
    }

    if (command === "entregar") {
      if (!isStaff(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      const order = findOrder(Number(args[0]));
      const details = args.slice(1).join(" ");

      if (!order || !details) {
        return message.reply(
          "Use: `!entregar ID detalhes da entrega`"
        );
      }

      order.status = "Entregue";
      order.delivery = details;
      saveDB();

      return message.reply({
        content: "📦 Pedido marcado como entregue!",
        embeds: [orderEmbed(order)]
      });
    }

    if (command === "cancelar") {
      if (!isStaff(message.member)) {
        return message.reply("Comando exclusivo da equipe.");
      }

      const order = findOrder(Number(args[0]));

      if (!order) {
        return message.reply("Pedido não encontrado.");
      }

      order.status = "Cancelado";
      saveDB();

      return message.reply("❌ Pedido cancelado.");
    }

  } catch (error) {
    console.error(error);

    return message.reply(
      `❌ ${error.message || "Ocorreu um erro."}`
    );
  }
});

// INTERAÇÕES SLASH, BOTÕES E MODAIS
client.on("interactionCreate", async interaction => {
  try {
    // BOTÕES
    if (interaction.isButton()) {

      if (interaction.customId === "ticket_buy") {
        return interaction.showModal(ticketModal("Compra"));
      }

      if (interaction.customId === "ticket_support") {
        return interaction.showModal(ticketModal("Suporte"));
      }

      if (interaction.customId === "ticket_staff") {
        return interaction.showModal(ticketModal("Equipe"));
      }

      if (interaction.customId === "ticket_close") {
        return closeTicket(interaction);
      }

      return;
    }

    // MODAIS
    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith("ticket_modal_")) return;

      const type = interaction.customId.replace("ticket_modal_", "");
      const details = interaction.fields.getTextInputValue("ticket_details");

      await interaction.deferReply({ ephemeral: true });

      const channel = await createTicket(
        interaction,
        type,
        details
      );

      return interaction.editReply(
        `✅ Seu ticket foi criado: ${channel}`
      );
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    // PAINEL DA LOJA
    if (command === "painel") {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "Somente a equipe pode publicar o painel.",
          ephemeral: true
        });
      }

      return interaction.reply({
        ...storePanel()
      });
    }

    // CATÁLOGO
    if (command === "catalogo") {
      return interaction.reply({
        ...catalogPanel()
      });
    }

    // CARRINHO
    if (command === "carrinho") {
      return interaction.reply({
        embeds: [cartEmbed(interaction.user.id)],
        ephemeral: true
      });
    }

    // COMPRAR
    if (command === "comprar") {
      const order = createOrder(interaction.user.id);

      await interaction.reply({
        content: `💙 Pedido **#${order.id}** criado!\n` +
          `Total: **${money(order.total)}**\n` +
          "A equipe confirmará seu pagamento manualmente.",
        embeds: [orderEmbed(order)],
        ephemeral: true
      });

      await notifyOrder(order);
      return;
    }

    // PEDIDO
    if (command === "pedido") {
      const order = findOrder(
        interaction.options.getInteger("id")
      );

      if (!order || order.userId !== interaction.user.id) {
        return interaction.reply({
          content: "Pedido não encontrado.",
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [orderEmbed(order)],
        ephemeral: true
      });
    }

    // ADICIONAR PRODUTO
    if (command === "adicionar") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const product = addProduct(
        interaction.options.getString("nome"),
        interaction.options.getString("preco"),
        interaction.options.getInteger("estoque"),
        interaction.options.getString("descricao") || ""
      );

      return interaction.reply(
        `✅ Produto **${product.name}** cadastrado com ID ${product.id}.`
      );
    }

    // ESTOQUE
    if (command === "estoque") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const product = db.products.find(
        p => p.id === interaction.options.getInteger("produto")
      );

      const quantity = interaction.options.getInteger("quantidade");

      if (!product || quantity < 0) {
        return interaction.reply({
          content: "Produto não encontrado ou quantidade inválida.",
          ephemeral: true
        });
      }

      product.stock = quantity;
      saveDB();

      return interaction.reply(
        `✅ Estoque de **${product.name}** atualizado para ${quantity}.`
      );
    }

    // REMOVER PRODUTO
    if (command === "removerproduto") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const id = interaction.options.getInteger("produto");
      const index = db.products.findIndex(p => p.id === id);

      if (index === -1) {
        return interaction.reply({
          content: "Produto não encontrado.",
          ephemeral: true
        });
      }

      const removed = db.products.splice(index, 1)[0];
      saveDB();

      return interaction.reply(
        `🗑️ Produto **${removed.name}** removido.`
      );
    }

    // LISTAR PEDIDOS
    if (command === "pedidos") {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const description = db.orders.length
        ? db.orders.slice(-15).map(order =>
            `**#${order.id}** — ${money(order.total)} — ${order.status}`
          ).join("\n")
        : "Nenhum pedido cadastrado.";

      return interaction.reply({
        embeds: [createEmbed("📦 PEDIDOS", description)],
        ephemeral: true
      });
    }

    // CONFIRMAR PAGAMENTO
    if (command === "pago") {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const order = findOrder(interaction.options.getInteger("id"));

      if (!order) {
        return interaction.reply({
          content: "Pedido não encontrado.",
          ephemeral: true
        });
      }

      order.status = "Pagamento confirmado";
      saveDB();

      return interaction.reply({
        embeds: [orderEmbed(order)]
      });
    }

    // ENTREGAR
    if (command === "entregar") {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const order = findOrder(interaction.options.getInteger("id"));
      const details = interaction.options.getString("detalhes");

      if (!order) {
        return interaction.reply({
          content: "Pedido não encontrado.",
          ephemeral: true
        });
      }

      order.status = "Entregue";
      order.delivery = details;
      saveDB();

      return interaction.reply({
        embeds: [orderEmbed(order)]
      });
    }

    // CANCELAR
    if (command === "cancelar") {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const order = findOrder(interaction.options.getInteger("id"));

      if (!order) {
        return interaction.reply({
          content: "Pedido não encontrado.",
          ephemeral: true
        });
      }

      order.status = "Cancelado";
      saveDB();

      return interaction.reply("❌ Pedido cancelado.");
    }

    // CUPOM ADM
    if (command === "cupomadm") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da equipe.",
          ephemeral: true
        });
      }

      const coupon = createCoupon(
        interaction.options.getString("codigo"),
        interaction.options.getNumber("porcentagem")
      );

      return interaction.reply(
        `✅ Cupom **${coupon.code}** configurado com ${coupon.percent}% de desconto.`
      );
    }

    // PUBLICAR PAINEL DE TICKETS
    if (command === "ticketpainel") {
      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "Somente a equipe pode publicar o painel.",
          ephemeral: true
        });
      }

      return interaction.reply({
        ...ticketPanel()
      });
    }

    // PERSONALIZAR PAINEL
    if (command === "ticketconfig") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da administração.",
          ephemeral: true
        });
      }

      updateTicketSettings(
        interaction.options.getString("titulo"),
        interaction.options.getString("descricao")
      );

      return interaction.reply({
        content: "✅ Painel personalizado! Use `/ticketpainel` para publicar a nova versão.",
        ephemeral: true
      });
    }

    // ALTERAR BANNER
    if (command === "ticketbanner") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da administração.",
          ephemeral: true
        });
      }

      updateTicketBanner(
        interaction.options.getString("url")
      );

      return interaction.reply({
        content: "✅ Banner atualizado! Use `/ticketpainel` para publicar.",
        ephemeral: true
      });
    }

    // RESTAURAR PAINEL
    if (command === "ticketreset") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "Comando exclusivo da administração.",
          ephemeral: true
        });
      }

      db.ticketSettings = {
        title: "💙 POCOYO STORE — ATENDIMENTO",
        description: "Escolha uma opção abaixo para abrir seu atendimento.",
        banner: null
      };

      saveDB();

      return interaction.reply({
        content: "✅ Configurações do painel restauradas.",
        ephemeral: true
      });
    }

  } catch (error) {
    console.error("Erro na interação:", error);

    const response = {
      content: `❌ ${error.message || "Ocorreu um erro."}`,
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      return interaction.followUp(response).catch(() => {});
    }

    return interaction.reply(response).catch(() => {});
  }
});

// INICIAR BOT
client.login(TOKEN);
