require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
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

// CONFIGURAÇÕES
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PREFIX = process.env.PREFIX || "!";

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const TICKET_STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const ORDERS_CHANNEL_ID = process.env.ORDERS_CHANNEL_ID;

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
  nextOrderId: 1001
};

if (fs.existsSync(DATA_FILE)) {
  try {
    db = {
      ...db,
      ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
    };
  } catch (error) {
    console.error("Erro ao carregar banco de dados:", error);
  }
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// CLIENTE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function isAdmin(member) {
  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID))
  );
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

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Mostra o painel da loja"),

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
    .setName("ticketpainel")
    .setDescription("Publica o painel de tickets"),

  new SlashCommandBuilder()
    .setName("adicionar")
    .setDescription("Adiciona um produto")
    .addStringOption(option =>
      option.setName("nome").setDescription("Nome").setRequired(true)
    )
    .addNumberOption(option =>
      option.setName("preco").setDescription("Preço").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("estoque").setDescription("Quantidade").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("estoque")
    .setDescription("Altera o estoque")
    .addIntegerOption(option =>
      option.setName("produto").setDescription("ID do produto").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("quantidade").setDescription("Nova quantidade").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removerproduto")
    .setDescription("Remove um produto")
    .addIntegerOption(option =>
      option.setName("produto").setDescription("ID do produto").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pedidos")
    .setDescription("Lista os pedidos"),

  new SlashCommandBuilder()
    .setName("pago")
    .setDescription("Marca pedido como pago")
    .addIntegerOption(option =>
      option.setName("id").setDescription("ID do pedido").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("entregar")
    .setDescription("Marca pedido como entregue")
    .addIntegerOption(option =>
      option.setName("id").setDescription("ID do pedido").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("detalhes").setDescription("Detalhes").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("cancelar")
    .setDescription("Cancela um pedido")
    .addIntegerOption(option =>
      option.setName("id").setDescription("ID do pedido").setRequired(true)
    )
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Comandos registrados!");
}

async function privateReply(interaction, content) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp({ content, ephemeral: true });
  }

  return interaction.reply({ content, ephemeral: true });
}

// PAINEL AZUL DE TICKETS
async function publishTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor("#168FE5")
    .setTitle("💙 POCOYO STORE")
    .setDescription(
      "Seja bem-vindo ao atendimento da **Pocoyo Store**!\n\n" +
      "🎫 Nosso atendimento funciona **24 horas**.\n\n" +
      "📦 Antes de abrir um ticket de compra, confira o estoque do **MM2**.\n\n" +
      "🛒 Abra um ticket somente para assuntos relacionados a compras.\n\n" +
      "💬 Precisa de ajuda? Escolha a opção de suporte."
    )
    .setFooter({ text: "POCOYO STORE • Atendimento" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_start")
      .setLabel("ABRIR ATENDIMENTO")
      .setEmoji("💙")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({
    embeds: [embed],
    components: [row]
  });
}

// ESCOLHA DO TIPO DE ATENDIMENTO
async function showTicketOptions(interaction) {
  const embed = new EmbedBuilder()
    .setColor("#168FE5")
    .setTitle("💙 ESCOLHA O ATENDIMENTO")
    .setDescription(
      "Como podemos ajudar você?\n\n" +
      "🛒 **COMPRA** — Para realizar uma compra na loja.\n\n" +
      "🛟 **SUPORTE** — Para tirar dúvidas ou pedir ajuda."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_purchase")
      .setLabel("COMPRA")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket_support")
      .setLabel("SUPORTE")
      .setEmoji("🛟")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

// FORMULÁRIO DE COMPRA
async function showPurchaseForm(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("ticket_purchase_form")
    .setTitle("🛒 Atendimento de compra");

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

// FORMULÁRIO DE SUPORTE
async function showSupportForm(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("ticket_support_form")
    .setTitle("🛟 Atendimento de suporte");

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

// CRIAR CANAL PRIVADO
async function createTicket(interaction, type, details) {
  const guild = interaction.guild;

  const existing = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    channel.topic === `ticket-${interaction.user.id}`
  );

  if (existing) {
    return privateReply(
      interaction,
      `Você já tem um ticket aberto: ${existing}`
    );
  }

  const permissionOverwrites = [
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
    permissionOverwrites.push({
      id: TICKET_STAFF_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const channel = await guild.channels.create({
    name: `${type}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
    type: ChannelType.GuildText,
    topic: `ticket-${interaction.user.id}`,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites
  });

  const embed = new EmbedBuilder()
    .setColor("#168FE5")
    .setTitle(type === "compra" ? "🛒 TICKET DE COMPRA" : "🛟 TICKET DE SUPORTE")
    .setDescription(
      `Olá ${interaction.user}!\n\n` +
      `${details}\n\n` +
      "Nossa equipe vai atender você. Aguarde um membro da equipe."
    );

  const closeRow = new ActionRowBuilder().addComponents(
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
    components: [closeRow]
  });

  await privateReply(interaction, `Seu ticket foi criado: ${channel}`);
}

// QUANDO O BOT INICIAR
client.once("ready", async () => {
  console.log(`${client.user.tag} está online!`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }
});

// COMANDOS POR PREFIXO
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const args = content.split(/\s+/);
  const command = args[0].toLowerCase();

  if (command === `${PREFIX}help` || command === `${PREFIX}ajuda`) {
    return message.author.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#168FE5")
          .setTitle("💙 POCOYO STORE — AJUDA")
          .setDescription(
            "**Comandos dos clientes:**\n\n" +
            "`!help` — Mostra esta ajuda.\n" +
            "`!cupom` — Mostra os cupons disponíveis.\n" +
            "`!calculadora` — Calcula descontos.\n\n" +
            "**Comandos de loja:**\n" +
            "`/catalogo` — Ver produtos.\n" +
            "`/carrinho` — Ver carrinho.\n" +
            "`/comprar` — Finalizar pedido.\n" +
            "`/pedido` — Consultar pedido."
          )
      ]
    }).catch(() =>
      message.reply("Ative suas mensagens privadas para receber a ajuda.")
    );
  }

  if (command === `${PREFIX}cupom`) {
    const coupons = db.coupons.filter(coupon => coupon.active !== false);

    if (!coupons.length) {
      return message.reply("💙 Não há cupons disponíveis no momento.");
    }

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#168FE5")
          .setTitle("🎟️ CUPONS DISPONÍVEIS")
          .setDescription(
            coupons.map(coupon =>
              `**${coupon.code}** — ${
                coupon.type === "percent"
                  ? `${coupon.value}% de desconto`
                  : `${money(coupon.value)} de desconto`
              }`
            ).join("\n")
          )
      ]
    });
  }

  if (command === `${PREFIX}calculadora`) {
    const price = parsePrice(args[1]);
    const discount = Number(args[2]);

    if (!Number.isFinite(price) || !Number.isFinite(discount) ||
        price < 0 || discount < 0 || discount > 100) {
      return message.reply(
        `Use assim: \`${PREFIX}calculadora 100 20\` para calcular 20% de desconto em R$100.`
      );
    }

    const finalPrice = price - (price * discount / 100);

    return message.reply(
      `💙 Valor original: ${money(price)}\n` +
      `🎟️ Desconto: ${discount}%\n` +
      `🛒 Valor final: **${money(finalPrice)}**`
    );
  }

  if (command === `${PREFIX}cupomadm`) {
    if (!isAdmin(message.member)) {
      return message.reply("❌ Comando exclusivo da equipe.");
    }

    const action = (args[1] || "").toLowerCase();

    if (action === "lista") {
      return message.reply(
        db.coupons.length
          ? db.coupons.map(c => `${c.code}: ${c.value}${c.type === "percent" ? "%" : " reais"}`).join("\n")
          : "Nenhum cupom cadastrado."
      );
    }

    if (action === "remover") {
      const code = (args[2] || "").toUpperCase();
      const before = db.coupons.length;
      db.coupons = db.coupons.filter(c => c.code !== code);
      saveDB();

      return message.reply(
        before === db.coupons.length
          ? "Cupom não encontrado."
          : `Cupom ${code} removido!`
      );
    }

    if (action === "criar") {
      const code = (args[2] || "").toUpperCase();
      const type = (args[3] || "").toLowerCase();
      const value = Number(args[4]);

      if (!code || !["percentual", "fixo"].includes(type) ||
          !Number.isFinite(value) || value <= 0 ||
          (type === "percentual" && value > 100)) {
        return message.reply(
          `Use: \`${PREFIX}cupomADM criar CODIGO percentual 20\` ou \`${PREFIX}cupomADM criar CODIGO fixo 5\``
        );
      }

      db.coupons = db.coupons.filter(c => c.code !== code);
      db.coupons.push({
        code,
        type: type === "percentual" ? "percent" : "fixed",
        value,
        active: true
      });

      saveDB();
      return message.reply(`✅ Cupom ${code} criado com sucesso!`);
    }

    return message.reply(
      "Use: `!cupomADM criar CODIGO percentual 20`, `!cupomADM lista` ou `!cupomADM remover CODIGO`."
    );
  }
});

// INTERAÇÕES DOS BOTÕES, FORMULÁRIOS E COMANDOS
client.on("interactionCreate", async interaction => {
  try {
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
        if (
          !isAdmin(interaction.member) &&
          !interaction.member.roles.cache.has(TICKET_STAFF_ROLE_ID || "0") &&
          interaction.channel.topic !== `ticket-${interaction.user.id}`
        ) {
          return privateReply(interaction, "Você não pode fechar este ticket.");
        }

        await privateReply(interaction, "🔒 Ticket será fechado.");
        return interaction.channel.delete();
      }
    }

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

      // COMANDOS SLASH
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // PAINEL DE TICKETS
      if (name === "ticketpainel") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        await publishTicketPanel(interaction.channel);
        return privateReply(interaction, "✅ Painel de tickets publicado!");
      }

      // PAINEL DA LOJA
      if (name === "painel") {
        const embed = new EmbedBuilder()
          .setColor("#168FE5")
          .setTitle("💙 POCOYO STORE")
          .setDescription(
            "Bem-vindo à nossa loja!\n\n" +
            "📦 Use `/catalogo` para ver os produtos.\n" +
            "🛒 Use `/carrinho` para consultar seu carrinho.\n" +
            "🎫 Use o painel de tickets para falar com a equipe."
          );

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // CATÁLOGO
      if (name === "catalogo") {
        if (!db.products.length) {
          return privateReply(interaction, "📦 Ainda não há produtos cadastrados.");
        }

        const description = db.products.map(product =>
          `**${product.id} — ${product.name}**\n` +
          `Preço: ${money(product.price)} | Estoque: ${product.stock}`
        ).join("\n\n");

        const embed = new EmbedBuilder()
          .setColor("#168FE5")
          .setTitle("🛍️ CATÁLOGO POCOYO STORE")
          .setDescription(description);

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // CARRINHO
      if (name === "carrinho") {
        const cart = db.carts[interaction.user.id] || [];

        if (!cart.length) {
          return privateReply(interaction, "🛒 Seu carrinho está vazio.");
        }

        return privateReply(interaction, "Seu carrinho:\n" + cart.map(item =>
          `${item.name} — ${money(item.price)}`
        ).join("\n"));
      }

      // COMPRAR
      if (name === "comprar") {
        const cart = db.carts[interaction.user.id] || [];

        if (!cart.length) {
          return privateReply(
            interaction,
            "🛒 Seu carrinho está vazio. Entre em contato com a equipe pelo ticket de compra."
          );
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
          `✅ Pedido #${order.id} criado!\nTotal: ${money(total)}\nPagamento será combinado manualmente com a equipe.`
        );
      }

      // CONSULTAR PEDIDO
      if (name === "pedido") {
        const id = interaction.options.getInteger("id");
        const order = db.orders.find(item => item.id === id);

        if (!order || (order.userId !== interaction.user.id && !isAdmin(interaction.member))) {
          return privateReply(interaction, "❌ Pedido não encontrado.");
        }

        return privateReply(
          interaction,
          `📦 Pedido #${order.id}\nStatus: ${order.status}\nTotal: ${money(order.total)}`
        );
      }

      // ADICIONAR PRODUTO
      if (name === "adicionar") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        const product = {
          id: db.nextProductId++,
          name: interaction.options.getString("nome"),
          price: interaction.options.getNumber("preco"),
          stock: interaction.options.getInteger("estoque")
        };

        if (product.price < 0 || product.stock < 0) {
          return privateReply(interaction, "❌ Preço e estoque não podem ser negativos.");
        }

        db.products.push(product);
        saveDB();

        return privateReply(interaction, `✅ Produto ${product.name} adicionado! ID: ${product.id}`);
      }

      // ALTERAR ESTOQUE
      if (name === "estoque") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        const id = interaction.options.getInteger("produto");
        const quantity = interaction.options.getInteger("quantidade");
        const product = db.products.find(item => item.id === id);

        if (!product) return privateReply(interaction, "❌ Produto não encontrado.");
        if (quantity < 0) return privateReply(interaction, "❌ Estoque inválido.");

        product.stock = quantity;
        saveDB();

        return privateReply(interaction, `✅ Estoque de ${product.name} atualizado para ${quantity}.`);
      }

      // REMOVER PRODUTO
      if (name === "removerproduto") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        const id = interaction.options.getInteger("produto");
        const before = db.products.length;
        db.products = db.products.filter(item => item.id !== id);
        saveDB();

        return privateReply(
          interaction,
          before === db.products.length ? "❌ Produto não encontrado." : "✅ Produto removido!"
        );
      }

      // LISTAR PEDIDOS
      if (name === "pedidos") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        if (!db.orders.length) return privateReply(interaction, "Nenhum pedido cadastrado.");

        return privateReply(interaction, db.orders.map(order =>
          `#${order.id} — ${order.status} — ${money(order.total)}`
        ).join("\n"));
      }

      // MARCAR COMO PAGO
      if (name === "pago") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        const id = interaction.options.getInteger("id");
        const order = db.orders.find(item => item.id === id);

        if (!order) return privateReply(interaction, "❌ Pedido não encontrado.");

        order.status = "Pago";
        saveDB();

        return privateReply(interaction, `✅ Pedido #${id} marcado como pago.`);
      }

      // ENTREGAR PEDIDO
      if (name === "entregar") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        const id = interaction.options.getInteger("id");
        const details = interaction.options.getString("detalhes");
        const order = db.orders.find(item => item.id === id);

        if (!order) return privateReply(interaction, "❌ Pedido não encontrado.");

        order.status = "Entregue";
        order.deliveryDetails = details;
        saveDB();

        return privateReply(interaction, `✅ Pedido #${id} marcado como entregue.`);
      }

      // CANCELAR PEDIDO
      if (name === "cancelar") {
        if (!isAdmin(interaction.member)) {
          return privateReply(interaction, "❌ Comando exclusivo da equipe.");
        }

        const id = interaction.options.getInteger("id");
        const order = db.orders.find(item => item.id === id);

        if (!order) return privateReply(interaction, "❌ Pedido não encontrado.");

        order.status = "Cancelado";
        saveDB();

        return privateReply(interaction, `✅ Pedido #${id} cancelado.`);
      }
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

// INICIAR BOT
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID no FadeHost.");
  process.exit(1);
}

client.login(TOKEN);
