require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PREFIX = process.env.PREFIX || "!";

const TICKET_STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;

// CARGOS AUTORIZADOS A EDITAR O PAINEL
const PANEL_ADMIN_ROLES = [
  "1564083080166379581",
  "1458908364758188309"
];

// BANCO DE DADOS
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {
  products: [],
  orders: [],
  carts: {},
  coupons: [],
  nextProductId: 1,
  nextOrderId: 1001,

  ticketSettings: {
    title: "💙 POCOYO STORE",
    description: "Bem-vindo ao nosso atendimento!",
    color: "#168FE5",
    image: "",
    thumbnail: "",
    openingMessage: "Olá! Nossa equipe vai atender você em breve.",
    purchaseEmoji: "🛒",
    supportEmoji: "🛟"
  },

  customEmojis: []
};

if (fs.existsSync(DATA_FILE)) {
  try {
    db = {
      ...db,
      ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
    };

    db.ticketSettings = {
      title: "💙 POCOYO STORE",
      description: "Bem-vindo ao nosso atendimento!",
      color: "#168FE5",
      image: "",
      thumbnail: "",
      openingMessage: "Olá! Nossa equipe vai atender você em breve.",
      purchaseEmoji: "🛒",
      supportEmoji: "🛟",
      ...(db.ticketSettings || {})
    };
  } catch (error) {
    console.error("Erro ao carregar banco:", error);
  }
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function parsePrice(value) {
  const number = Number(
    String(value).replace(",", ".").replace(/[^\d.]/g, "")
  );

  return Number.isFinite(number) ? number : NaN;
}

function canEditPanel(member) {
  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    PANEL_ADMIN_ROLES.some(roleId => member.roles.cache.has(roleId))
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName("ticketpainel")
    .setDescription("Publica o painel de atendimento"),

  new SlashCommandBuilder()
    .setName("ticketconfig")
    .setDescription("Configura o painel de tickets")
    .addStringOption(o => o.setName("campo").setDescription("O que deseja alterar").setRequired(true)
      .addChoices(
        { name: "Título", value: "title" },
        { name: "Descrição", value: "description" },
        { name: "Cor", value: "color" },
        { name: "Imagem", value: "image" },
        { name: "Thumbnail", value: "thumbnail" },
        { name: "Mensagem de abertura", value: "openingMessage" }
      ))
    .addStringOption(o => o.setName("valor").setDescription("Novo valor; para remover imagem, use limpar").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticketemoji")
    .setDescription("Adiciona um emoji personalizado ao servidor")
    .addStringOption(o => o.setName("nome").setDescription("Nome do emoji, sem espaços").setRequired(true))
    .addAttachmentOption(o => o.setName("imagem").setDescription("Imagem do emoji").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticketemojis")
    .setDescription("Mostra os emojis cadastrados"),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Mostra o painel da loja"),

  new SlashCommandBuilder()
    .setName("catalogo")
    .setDescription("Mostra os produtos"),

  new SlashCommandBuilder()
    .setName("carrinho")
    .setDescription("Mostra seu carrinho"),

  new SlashCommandBuilder()
    .setName("comprar")
    .setDescription("Finaliza seu pedido"),

  new SlashCommandBuilder()
    .setName("pedido")
    .setDescription("Consulta um pedido")
    .addIntegerOption(o => o.setName("id").setDescription("Número do pedido").setRequired(true)),

  new SlashCommandBuilder()
    .setName("adicionar")
    .setDescription("Adiciona um produto")
    .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
    .addNumberOption(o => o.setName("preco").setDescription("Preço").setRequired(true))
    .addIntegerOption(o => o.setName("estoque").setDescription("Estoque").setRequired(true)),

  new SlashCommandBuilder()
    .setName("estoque")
    .setDescription("Altera o estoque")
    .addIntegerOption(o => o.setName("produto").setDescription("ID do produto").setRequired(true))
    .addIntegerOption(o => o.setName("quantidade").setDescription("Nova quantidade").setRequired(true)),

  new SlashCommandBuilder()
    .setName("removerproduto")
    .setDescription("Remove um produto")
    .addIntegerOption(o => o.setName("produto").setDescription("ID do produto").setRequired(true)),

  new SlashCommandBuilder()
    .setName("pedidos")
    .setDescription("Lista os pedidos"),

  new SlashCommandBuilder()
    .setName("pago")
    .setDescription("Marca um pedido como pago")
    .addIntegerOption(o => o.setName("id").setDescription("ID do pedido").setRequired(true)),

  new SlashCommandBuilder()
    .setName("entregar")
    .setDescription("Marca um pedido como entregue")
    .addIntegerOption(o => o.setName("id").setDescription("ID do pedido").setRequired(true))
    .addStringOption(o => o.setName("detalhes").setDescription("Detalhes da entrega").setRequired(true)),

  new SlashCommandBuilder()
    .setName("cancelar")
    .setDescription("Cancela um pedido")
    .addIntegerOption(o => o.setName("id").setDescription("ID do pedido").setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
}

async function privateReply(interaction, content) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ content, ephemeral: true });
  }
  return interaction.reply({ content, ephemeral: true });
}

function ticketEmoji(value) {
  if (!value) return "🎫";
  return value;
}

async function publishTicketPanel(channel) {
  const s = db.ticketSettings;
  const embed = new EmbedBuilder()
    .setColor(s.color)
    .setTitle(s.title)
    .setDescription(s.description);

  if (s.image) embed.setImage(s.image);
  if (s.thumbnail) embed.setThumbnail(s.thumbnail);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_start")
      .setLabel("ABRIR ATENDIMENTO")
      .setEmoji("💙")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function showTicketOptions(interaction) {
  const embed = new EmbedBuilder()
    .setColor("#168FE5")
    .setTitle("💙 ESCOLHA O ATENDIMENTO")
    .setDescription(
      "Como podemos ajudar?\n\n" +
      "🛒 **COMPRA** — Para comprar produtos.\n\n" +
      "🛡️ **SUPORTE** — Para tirar dúvidas ou pedir ajuda."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_purchase")
      .setLabel("COMPRA")
      .setEmoji(db.ticketSettings.purchaseEmoji)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ticket_support")
      .setLabel("SUPORTE")
      .setEmoji(db.ticketSettings.supportEmoji)
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

async function showPurchaseForm(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("ticket_purchase_form")
    .setTitle("Atendimento de compra");

  const nick = new TextInputBuilder()
    .setCustomId("nick")
    .setLabel("Seu nick no Roblox")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const items = new TextInputBuilder()
    .setCustomId("items")
    .setLabel("Quais itens deseja comprar?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const quantity = new TextInputBuilder()
    .setCustomId("quantity")
    .setLabel("Quantidade")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const notes = new TextInputBuilder()
    .setCustomId("notes")
    .setLabel("Observações (opcional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nick),
    new ActionRowBuilder().addComponents(items),
    new ActionRowBuilder().addComponents(quantity),
    new ActionRowBuilder().addComponents(notes)
  );

  await interaction.showModal(modal);
}

async function showSupportForm(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("ticket_support_form")
    .setTitle("Atendimento de suporte");

  const question = new TextInputBuilder()
    .setCustomId("question")
    .setLabel("Escreva sua dúvida ou problema")
    .setPlaceholder("Conte como podemos ajudar...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(question)
  );

  await interaction.showModal(modal);
}

async function createTicket(interaction, type, details) {
  const guild = interaction.guild;

  const existing = guild.channels.cache.find(c =>
    c.type === ChannelType.GuildText &&
    c.topic === `ticket-${interaction.user.id}`
  );

  if (existing) {
    return privateReply(interaction, `Você já tem um ticket aberto: ${existing}`);
  }

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];

  if (TICKET_STAFF_ROLE_ID) {
    overwrites.push({
      id: TICKET_STAFF_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const channel = await guild.channels.create({
    name: `${type}-${interaction.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 90),
    type: ChannelType.GuildText,
    topic: `ticket-${interaction.user.id}`,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites
  });

  const s = db.ticketSettings;
  const embed = new EmbedBuilder()
    .setColor(s.color)
    .setTitle(type === "compra" ? "🛒 TICKET DE COMPRA" : "🛟 TICKET DE SUPORTE")
    .setDescription(
      `${interaction.user}\n\n${s.openingMessage}\n\n${details}`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("FECHAR TICKET")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: TICKET_STAFF_ROLE_ID
      ? `<@&${TICKET_STAFF_ROLE_ID}> ${interaction.user}`
      : `${interaction.user}`,
    embeds: [embed],
    components: [row]
  });

  await privateReply(interaction, `✅ Seu ticket foi criado: ${channel}`);
}

client.once("ready", async () => {
  console.log(`${client.user.tag} está online!`);

  try {
    await registerCommands();
    console.log("Comandos registrados!");
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    // BOTÕES
    if (interaction.isButton()) {
      if (interaction.customId === "ticket_start") {
        return showTicketOptions(interaction);
      }

      if (interaction.customId === "ticket_purchase") {
        return showPurchaseForm(interaction);
      }

      if (interaction.customId === "ticket_support") {
        return showSupportForm(interaction);
      }

      if (interaction.customId === "ticket_close") {
        const isOwner =
          interaction.channel.topic === `ticket-${interaction.user.id}`;

        const hasStaffRole =
          TICKET_STAFF_ROLE_ID &&
          interaction.member.roles.cache.has(TICKET_STAFF_ROLE_ID);

        if (!isOwner && !hasStaffRole && !canEditPanel(interaction.member)) {
          return privateReply(interaction, "❌ Você não pode fechar este ticket.");
        }

        await privateReply(interaction, "🔒 Fechando o ticket...");
        return interaction.channel.delete();
      }
    }

    // FORMULÁRIOS
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "ticket_purchase_form") {
        const details =
          `**Nick Roblox:** ${interaction.fields.getTextInputValue("nick")}\n` +
          `**Itens:** ${interaction.fields.getTextInputValue("items")}\n` +
          `**Quantidade:** ${interaction.fields.getTextInputValue("quantity")}\n` +
          `**Observações:** ${interaction.fields.getTextInputValue("notes") || "Nenhuma"}`;

        return createTicket(interaction, "compra", details);
      }

      if (interaction.customId === "ticket_support_form") {
        const details =
          `**Dúvida ou problema:**\n${interaction.fields.getTextInputValue("question")}`;

        return createTicket(interaction, "suporte", details);
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    // PUBLICAR PAINEL
    if (name === "ticketpainel") {
      if (!canEditPanel(interaction.member)) {
        return privateReply(interaction, "❌ Você não tem autorização para publicar o painel.");
      }

      await publishTicketPanel(interaction.channel);
      return privateReply(interaction, "✅ Painel publicado!");
    }

    // CONFIGURAR PAINEL
    if (name === "ticketconfig") {
      if (!canEditPanel(interaction.member)) {
        return privateReply(interaction, "❌ Você não tem autorização para editar o painel.");
      }

      const field = interaction.options.getString("campo");
      const value = interaction.options.getString("valor").trim();

      if (field === "color" && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
        return privateReply(interaction, "Use uma cor hexadecimal, por exemplo: #168FE5");
      }

      if (["image", "thumbnail"].includes(field) &&
          value.toLowerCase() !== "limpar" &&
          !/^https:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(value)) {
        return privateReply(interaction, "Envie um link HTTPS direto para uma imagem PNG, JPG, GIF ou WEBP.");
      }

      db.ticketSettings[field] =
        value.toLowerCase() === "limpar" &&
        ["image", "thumbnail"].includes(field)
          ? ""
          : value;

      saveDB();

      return privateReply(
        interaction,
        `✅ Configuração **${field}** salva! Para publicar a versão atualizada, use /ticketpainel novamente.`
      );
    }

    // CADASTRAR EMOJI DO SERVIDOR A PARTIR DE IMAGEM
    if (name === "ticketemoji") {
      if (!canEditPanel(interaction.member)) {
        return privateReply(interaction, "❌ Você não tem autorização para cadastrar emojis.");
      }

      const emojiName = interaction.options.getString("nome")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 32);

      const attachment = interaction.options.getAttachment("imagem");

      if (!emojiName || !attachment.contentType?.startsWith("image/")) {
        return privateReply(interaction, "❌ Envie uma imagem e use um nome válido, sem espaços.");
      }

      const emoji = await interaction.guild.emojis.create({
        attachment: attachment.url,
        name: emojiName,
        reason: `Emoji cadastrado por ${interaction.user.tag} para a Pocoyo Store`
      });

      db.customEmojis.push({
        name: emoji.name,
        id: emoji.id,
        animated: emoji.animated
      });
      saveDB();

      const emojiText = emoji.animated
        ? `<a:${emoji.name}:${emoji.id}>`
        : `<:${emoji.name}:${emoji.id}>`;

      return privateReply(
        interaction,
        `✅ Emoji cadastrado: ${emojiText}\n\nPara usar no botão de suporte, execute:\n\`/ticketconfig campo:SUPORTE valor:${emojiText}\`\n\nPara COMPRA, use o campo COMPRA.`
      );
    }

    if (name === "ticketemojis") {
      if (!canEditPanel(interaction.member)) {
        return privateReply(interaction, "❌ Você não tem autorização.");
      }

      const emojis = interaction.guild.emojis.cache
        .map(e => `${e} — \`${e.name}\` — \`${e.id}\``)
        .join("\n");

      return privateReply(
        interaction,
        emojis || "Nenhum emoji personalizado encontrado."
      );
    }

      // PAINEL DA LOJA
    if (name === "painel") {
      const embed = new EmbedBuilder()
        .setColor("#168FE5")
        .setTitle("💙 POCOYO STORE")
        .setDescription(
          "Bem-vindo à nossa loja!\n\n" +
          "📦 `/catalogo` — Ver produtos.\n" +
          "🛒 `/carrinho` — Ver carrinho.\n" +
          "💳 `/comprar` — Finalizar pedido.\n" +
          "🎫 Use nosso painel de tickets para falar com a equipe."
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // CATÁLOGO
    if (name === "catalogo") {
      if (!db.products.length) {
        return privateReply(interaction, "📦 Ainda não há produtos cadastrados.");
      }

      const description = db.products.map(p =>
        `**${p.id} — ${p.name}**\nPreço: ${money(p.price)} | Estoque: ${p.stock}`
      ).join("\n\n");

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#168FE5")
            .setTitle("🛍️ CATÁLOGO POCOYO STORE")
            .setDescription(description)
        ],
        ephemeral: true
      });
    }

    // CARRINHO
    if (name === "carrinho") {
      const cart = db.carts[interaction.user.id] || [];

      if (!cart.length) {
        return privateReply(interaction, "🛒 Seu carrinho está vazio.");
      }

      return privateReply(
        interaction,
        cart.map(item => `${item.name} — ${money(item.price)}`).join("\n")
      );
    }

    // COMPRAR
    if (name === "comprar") {
      const cart = db.carts[interaction.user.id] || [];

      if (!cart.length) {
        return privateReply(interaction, "🛒 Seu carrinho está vazio. Abra um ticket de compra.");
      }

      const total = cart.reduce((sum, item) => sum + item.price, 0);
      const order = {
        id: db.nextOrderId++,
        userId: interaction.user.id,
        items: cart,
        total,
        status: "Aguardando pagamento"
      };

      db.orders.push(order);
      db.carts[interaction.user.id] = [];
      saveDB();

      return privateReply(
        interaction,
        `✅ Pedido #${order.id} criado!\nTotal: ${money(total)}\nPagamento combinado manualmente com a equipe.`
      );
    }

    // CONSULTAR PEDIDO
    if (name === "pedido") {
      const id = interaction.options.getInteger("id");
      const order = db.orders.find(o => o.id === id);

      if (!order || (order.userId !== interaction.user.id && !canEditPanel(interaction.member))) {
        return privateReply(interaction, "❌ Pedido não encontrado.");
      }

      return privateReply(
        interaction,
        `📦 Pedido #${order.id}\nStatus: ${order.status}\nTotal: ${money(order.total)}`
      );
    }

    // COMANDOS DA EQUIPE
    if (["adicionar", "estoque", "removerproduto", "pedidos", "pago", "entregar", "cancelar"].includes(name)) {
      if (!canEditPanel(interaction.member)) {
        return privateReply(interaction, "❌ Comando exclusivo da equipe.");
      }

      if (name === "adicionar") {
        const price = interaction.options.getNumber("preco");
        const stock = interaction.options.getInteger("estoque");

        if (price < 0 || stock < 0) {
          return privateReply(interaction, "❌ Preço e estoque não podem ser negativos.");
        }

        const product = {
          id: db.nextProductId++,
          name: interaction.options.getString("nome"),
          price,
          stock
        };

        db.products.push(product);
        saveDB();

        return privateReply(interaction, `✅ Produto ${product.name} adicionado! ID: ${product.id}`);
      }

      if (name === "estoque") {
        const id = interaction.options.getInteger("produto");
        const quantity = interaction.options.getInteger("quantidade");
        const product = db.products.find(p => p.id === id);

        if (!product) return privateReply(interaction, "❌ Produto não encontrado.");
        if (quantity < 0) return privateReply(interaction, "❌ Quantidade inválida.");

        product.stock = quantity;
        saveDB();

        return privateReply(interaction, `✅ Estoque atualizado: ${product.name} — ${quantity}`);
      }

      if (name === "removerproduto") {
        const id = interaction.options.getInteger("produto");
        const before = db.products.length;
        db.products = db.products.filter(p => p.id !== id);
        saveDB();

        return privateReply(
          interaction,
          before === db.products.length ? "❌ Produto não encontrado." : "✅ Produto removido!"
        );
      }

      if (name === "pedidos") {
        if (!db.orders.length) return privateReply(interaction, "Nenhum pedido cadastrado.");

        return privateReply(
          interaction,
          db.orders.map(o => `#${o.id} — ${o.status} — ${money(o.total)}`).join("\n")
        );
      }

      const id = interaction.options.getInteger("id");
      const order = db.orders.find(o => o.id === id);

      if (!order) return privateReply(interaction, "❌ Pedido não encontrado.");

      if (name === "pago") {
        order.status = "Pago";
      } else if (name === "entregar") {
        order.status = "Entregue";
        order.deliveryDetails = interaction.options.getString("detalhes");
      } else if (name === "cancelar") {
        order.status = "Cancelado";
      }

      saveDB();
      return privateReply(interaction, `✅ Pedido #${id}: ${order.status}.`);
    }

  } catch (error) {
    console.error("Erro na interação:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Ocorreu um erro. Tente novamente.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// COMANDOS POR PREFIXO
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = (args[0] || "").toLowerCase();

  if (command === `${PREFIX}help` || command === `${PREFIX}ajuda`) {
    return message.reply(
      "**💙 POCOYO STORE — AJUDA**\n\n" +
      "`/catalogo` — Ver produtos.\n" +
      "`/carrinho` — Ver carrinho.\n" +
      "`/comprar` — Finalizar pedido.\n" +
      "`/pedido` — Consultar pedido.\n" +
      "`!help` — Mostrar ajuda."
    );
  }

  if (command === `${PREFIX}cupom`) {
    const coupons = db.coupons.filter(c => c.active !== false);

    return message.reply(
      coupons.length
        ? coupons.map(c => `**${c.code}** — ${c.value}${c.type === "percent" ? "%" : " reais"}`).join("\n")
        : "💙 Não há cupons disponíveis."
    );
  }

  if (command === `${PREFIX}calculadora`) {
    const price = parsePrice(args[1]);
    const discount = Number(args[2]);

    if (!Number.isFinite(price) || !Number.isFinite(discount) ||
        price < 0 || discount < 0 || discount > 100) {
      return message.reply(`Use: \`${PREFIX}calculadora 100 20\` para calcular 20% de desconto em R$100.`);
    }

    return message.reply(
      `💙 Valor original: ${money(price)}\n` +
      `🎟️ Desconto: ${discount}%\n` +
      `🛒 Valor final: **${money(price - price * discount / 100)}**`
    );
  }
});

// INICIAR
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID no FadeHost.");
  process.exit(1);
}

client.login(TOKEN);
