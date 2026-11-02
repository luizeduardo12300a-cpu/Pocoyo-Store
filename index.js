require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const TOKEN =
  process.env.DISCORD_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TOKEN;

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || "1456070163010031703";

const TICKET_CATEGORY_ID =
  process.env.TICKET_CATEGORY_ID || "1458925791038669053";

const TICKET_STAFF_ROLE_ID =
  process.env.TICKET_STAFF_ROLE_ID || "1458908364758188309";

const ADMIN_ROLES = [
  "1564083080166379581",
  "1458908364758188309"
];

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("Configure TOKEN, CLIENT_ID e GUILD_ID no FadeHost.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DB_PATH = path.join(__dirname, "store.json");

const defaultDB = {
  products: [],
  orders: [],
  carts: {},
  coupons: [],
  nextProductId: 1,
  nextOrderId: 1001,

  ticketSettings: {
    title: "˚₊‧ Ticket Compras ‧₊˚",
    description: "Seja bem-vindo(a) ao nosso Ticket de Compras!",
    color: "#168FE5",
    imageUrl: "",
    thumbnailUrl: "",
    footer: "💙 Pocoyo Store © 2026",
    openingMessage: "Olá! Nossa equipe atenderá você manualmente.",
    buyButton: "🛒 Comprar Produtos",
    supportButton: "🛟 Suporte",
    staffButton: "🎧 Fale com a Equipe"
  }
};

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB, null, 2));
      return structuredClone(defaultDB);
    }

    const saved = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));

    return {
      ...structuredClone(defaultDB),
      ...saved,
      ticketSettings: {
        ...defaultDB.ticketSettings,
        ...(saved.ticketSettings || {})
      }
    };
  } catch (error) {
    console.error("Erro ao carregar banco de dados:", error);
    return structuredClone(defaultDB);
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function money(value) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function parsePrice(value) {
  const number = Number(
    String(value).replace(/\./g, "").replace(",", ".")
  );

  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isAdmin(member) {
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return ADMIN_ROLES.some(id => member?.roles?.cache?.has(id));
}

function isStaff(member) {
  return isAdmin(member) ||
    member?.roles?.cache?.has(TICKET_STAFF_ROLE_ID);
}

console.log("Base da Pocoyo Store carregada.");

const commands = [
  new SlashCommandBuilder().setName("painel").setDescription("Publica o painel da loja"),
  new SlashCommandBuilder().setName("catalogo").setDescription("Mostra os produtos"),
  new SlashCommandBuilder().setName("carrinho").setDescription("Mostra seu carrinho"),
  new SlashCommandBuilder().setName("comprar").setDescription("Finaliza seu pedido"),
  new SlashCommandBuilder().setName("pedido").setDescription("Consulta seu pedido")
    .addIntegerOption(o => o.setName("id").setDescription("ID do pedido").setRequired(true)),

  new SlashCommandBuilder().setName("adicionar").setDescription("Adiciona produto (equipe)")
    .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
    .addStringOption(o => o.setName("preco").setDescription("Preço, exemplo 19,90").setRequired(true))
    .addIntegerOption(o => o.setName("estoque").setDescription("Quantidade").setRequired(true))
    .addStringOption(o => o.setName("descricao").setDescription("Descrição")),
  new SlashCommandBuilder().setName("estoque").setDescription("Altera estoque (equipe)")
    .addIntegerOption(o => o.setName("produto").setDescription("ID do produto").setRequired(true))
    .addIntegerOption(o => o.setName("quantidade").setDescription("Novo estoque").setRequired(true)),
  new SlashCommandBuilder().setName("removerproduto").setDescription("Remove produto (equipe)")
    .addIntegerOption(o => o.setName("produto").setDescription("ID do produto").setRequired(true)),
  new SlashCommandBuilder().setName("pedidos").setDescription("Lista pedidos (equipe)"),
  new SlashCommandBuilder().setName("pago").setDescription("Marca pedido como pago (equipe)")
    .addIntegerOption(o => o.setName("id").setDescription("ID do pedido").setRequired(true)),
  new SlashCommandBuilder().setName("entregar").setDescription("Marca pedido como entregue (equipe)")
    .addIntegerOption(o => o.setName("id").setDescription("ID do pedido").setRequired(true))
    .addStringOption(o => o.setName("detalhes").setDescription("Detalhes da entrega")),
  new SlashCommandBuilder().setName("cancelar").setDescription("Cancela pedido (equipe)")
    .addIntegerOption(o => o.setName("id").setDescription("ID do pedido").setRequired(true)),

  new SlashCommandBuilder().setName("cupomADM").setDescription("Cria ou altera um cupom (equipe)")
    .addStringOption(o => o.setName("nome").setDescription("Nome do cupom").setRequired(true))
    .addNumberOption(o => o.setName("porcentagem").setDescription("Desconto em %").setRequired(true)),
  new SlashCommandBuilder().setName("ticketpainel").setDescription("Publica o painel de tickets"),
  new SlashCommandBuilder().setName("ticketbanner").setDescription("Altera a imagem do painel")
    .addAttachmentOption(o => o.setName("imagem").setDescription("Nova imagem").setRequired(true)),
  new SlashCommandBuilder().setName("ticketconfig").setDescription("Personaliza o painel de tickets")
    .addStringOption(o => o.setName("campo").setDescription("O que deseja mudar").setRequired(true)
      .addChoices(
        { name: "Título", value: "title" },
        { name: "Descrição", value: "description" },
        { name: "Cor", value: "color" },
        { name: "Thumbnail (URL)", value: "thumbnailUrl" },
        { name: "Mensagem de abertura", value: "openingMessage" },
        { name: "Botão Comprar", value: "buyButton" },
        { name: "Botão Suporte", value: "supportButton" },
        { name: "Botão Equipe", value: "staffButton" },
        { name: "Rodapé", value: "footer" }
      ))
    .addStringOption(o => o.setName("valor").setDescription("Novo valor").setRequired(true)),
  new SlashCommandBuilder().setName("ticketreset").setDescription("Restaura o painel de tickets")
];

function ticketEmbed() {
  const p = db.ticketSettings;
  const embed = new EmbedBuilder()
    .setColor(p.color)
    .setTitle(p.title)
    .setDescription(p.description)
    .setFooter({ text: p.footer });

  if (p.imageUrl) embed.setImage(p.imageUrl);
  if (p.thumbnailUrl) embed.setThumbnail(p.thumbnailUrl);
  return embed;
}

function ticketButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_buy").setLabel(db.ticketSettings.buyButton).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ticket_support").setLabel(db.ticketSettings.supportButton).setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ticket_staff").setLabel(db.ticketSettings.staffButton).setStyle(ButtonStyle.Secondary)
    )
  ];
}

function getCart(userId) {
  if (!Array.isArray(db.carts[userId])) db.carts[userId] = [];
  return db.carts[userId];
}

function findProduct(id) {
  return db.products.find(p => p.id === Number(id));
}

function totalCart(cart) {
  return cart.reduce((total, item) => {
    const product = findProduct(item.productId);
    return total + (product ? product.price * item.quantity : 0);
  }, 0);
}

async function openTicket(interaction, type, details) {
  const channel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || undefined,
    topic: `ticket-owner:${interaction.user.id}`,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: TICKET_STAFF_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ]
  });

  const closeButton = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("🔒 Fechar ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `${db.ticketSettings.openingMessage}\n\n**Cliente:** <@${interaction.user.id}>\n**Tipo:** ${type}\n**Informações:** ${details}\n\n<@&${TICKET_STAFF_ROLE_ID}>`,
    components: [closeButton]
  });

  await interaction.reply({
    content: `💙 Seu ticket foi criado: ${channel}`,
    ephemeral: true
  });
}

async function showTicketModal(interaction, type) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_form_${type}`)
    .setTitle(type === "compra" ? "Comprar Produtos" : type === "suporte" ? "Suporte" : "Fale com a Equipe");

  const field = new TextInputBuilder()
    .setCustomId("details")
    .setLabel(type === "compra" ? "Informe os produtos desejados" : "Como podemos ajudar?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(field));
  await interaction.showModal(modal);
}

client.once("ready", async () => {
  console.log(`💙 Pocoyo Store online: ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log("Comandos registrados!");
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;

    if (cmd === "painel") {
      return interaction.reply({
        embeds: [ticketEmbed()],
        components: ticketButtons()
      });
    }

    if (cmd === "ticketpainel") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: "⛔ Você não pode publicar o painel.", ephemeral: true });
      }
      await interaction.channel.send({ embeds: [ticketEmbed()], components: ticketButtons() });
      return interaction.reply({ content: "✅ Painel publicado!", ephemeral: true });
    }

    if (cmd === "catalogo") {
      const products = db.products.filter(p => p.stock > 0);
      if (!products.length) {
        return interaction.reply({ content: "Ainda não há produtos disponíveis.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor("#168FE5")
        .setTitle("💙 Catálogo Pocoyo Store")
        .setDescription(products.map(p =>
          `**#${p.id} — ${p.name}**\n${p.description || "Sem descrição"}\n${money(p.price)} • Estoque: ${p.stock}`
        ).join("\n\n"));

      const menu = new StringSelectMenuBuilder()
        .setCustomId("cart_add")
        .setPlaceholder("Escolha um produto")
        .addOptions(products.slice(0, 25).map(p => ({
          label: `#${p.id} ${p.name}`.slice(0, 100),
          description: `${money(p.price)} • Estoque ${p.stock}`.slice(0, 100),
          value: String(p.id)
        })));

      return interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    if (cmd === "carrinho") {
      const cart = getCart(interaction.user.id);
      if (!cart.length) {
        return interaction.reply({ content: "🛒 Seu carrinho está vazio. Use `/catalogo`.", ephemeral: true });
      }

      const lines = cart.map(item => {
        const p = findProduct(item.productId);
        return p ? `• ${p.name} x${item.quantity} — ${money(p.price * item.quantity)}` : "";
      }).filter(Boolean);

      return interaction.reply({
        content: `🛒 **Seu carrinho**\n${lines.join("\n")}\n\n**Total: ${money(totalCart(cart))}**`,
        ephemeral: true
      });
    }

    if (cmd === "comprar") {
      const cart = getCart(interaction.user.id);
      if (!cart.length) {
        return interaction.reply({ content: "Seu carrinho está vazio. Use `/catalogo`.", ephemeral: true });
      }

      for (const item of cart) {
        const p = findProduct(item.productId);
        if (!p || p.stock < item.quantity) {
          return interaction.reply({ content: `Estoque insuficiente: ${p?.name || "produto"}.`, ephemeral: true });
        }
      }

      const order = {
        id: db.nextOrderId++,
        userId: interaction.user.id,
        items: cart.map(item => ({ ...item })),
        total: totalCart(cart),
        status: "Aguardando pagamento"
      };

      for (const item of cart) findProduct(item.productId).stock -= item.quantity;
      db.orders.push(order);
      db.carts[interaction.user.id] = [];
      saveDB();

      return interaction.reply({
        content: `💙 Pedido **#${order.id}** criado!\nTotal: **${money(order.total)}**\nPagamento e entrega serão feitos manualmente pela equipe.`,
        ephemeral: true
      });
    }

    if (cmd === "pedido") {
      const id = interaction.options.getInteger("id");
      const order = db.orders.find(o =>
        o.id === id && (o.userId === interaction.user.id || isStaff(interaction.member))
      );

      if (!order) return interaction.reply({ content: "Pedido não encontrado.", ephemeral: true });

      return interaction.reply({
        content: `🧾 Pedido **#${order.id}**\nStatus: **${order.status}**\nTotal: ${money(order.total)}`,
        ephemeral: true
      });
    }

    if (["adicionar", "estoque", "removerproduto", "pedidos", "pago", "entregar", "cancelar", "cupomADM"].includes(cmd)) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "⛔ Comando exclusivo da equipe.", ephemeral: true });
      }
    }

    if (cmd === "adicionar") {
      const price = parsePrice(interaction.options.getString("preco"));
      const stock = interaction.options.getInteger("estoque");

      if (price === null || stock < 0) {
        return interaction.reply({ content: "Preço ou estoque inválido.", ephemeral: true });
      }

      const product = {
        id: db.nextProductId++,
        name: interaction.options.getString("nome"),
        price,
        stock,
        description: interaction.options.getString("descricao") || ""
      };

      db.products.push(product);
      saveDB();
      return interaction.reply({ content: `✅ Produto **#${product.id} ${product.name}** adicionado!` });
    }

    if (cmd === "estoque") {
      const product = findProduct(interaction.options.getInteger("produto"));
      const amount = interaction.options.getInteger("quantidade");

      if (!product || amount < 0) {
        return interaction.reply({ content: "Produto ou quantidade inválida.", ephemeral: true });
      }

      product.stock = amount;
      saveDB();
      return interaction.reply({ content: `✅ Estoque de **${product.name}** atualizado.` });
    }

    if (cmd === "removerproduto") {
      const id = interaction.options.getInteger("produto");
      db.products = db.products.filter(p => p.id !== id);
      saveDB();
      return interaction.reply({ content: "✅ Produto removido." });
    }

    if (cmd === "pedidos") {
      const recent = db.orders.slice(-15);
      return interaction.reply({
        content: recent.length
          ? recent.map(o => `#${o.id} — <@${o.userId}> — ${money(o.total)} — ${o.status}`).join("\n")
          : "Nenhum pedido registrado.",
        ephemeral: true
      });
    }

    if (["pago", "entregar", "cancelar"].includes(cmd)) {
      const id = interaction.options.getInteger("id");
      const order = db.orders.find(o => o.id === id);
      if (!order) return interaction.reply({ content: "Pedido não encontrado.", ephemeral: true });

      if (cmd === "pago") order.status = "Pago";
      if (cmd === "entregar") order.status = "Entregue";
      if (cmd === "cancelar") order.status = "Cancelado";

      saveDB();
      return interaction.reply({ content: `✅ Pedido #${id}: **${order.status}**` });
    }

    if (cmd === "cupomADM") {
      const name = interaction.options.getString("nome").toLowerCase();
      const percent = interaction.options.getNumber("porcentagem");

      if (percent <= 0 || percent > 100) {
        return interaction.reply({ content: "Use uma porcentagem entre 1 e 100.", ephemeral: true });
      }

      const existing = db.coupons.find(c => c.name === name);
      if (existing) existing.percent = percent;
      else db.coupons.push({ name, percent });

      saveDB();
      return interaction.reply({ content: `✅ Cupom **${name}** configurado com ${percent}% de desconto.` });
    }

  // PERSONALIZAÇÃO DO PAINEL DE TICKETS

    if (cmd === "ticketbanner") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "⛔ Você não pode alterar o banner.",
          ephemeral: true
        });
      }

      const image = interaction.options.getAttachment("imagem");

      if (!image.contentType?.startsWith("image/")) {
        return interaction.reply({
          content: "Envie um arquivo de imagem.",
          ephemeral: true
        });
      }

      db.ticketSettings.imageUrl = image.url;
      saveDB();

      return interaction.reply({
        content: "🖼️ Banner atualizado! Use /ticketpainel para publicar novamente.",
        ephemeral: true
      });
    }

    if (cmd === "ticketconfig") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "⛔ Você não pode personalizar o painel.",
          ephemeral: true
        });
      }

      const field = interaction.options.getString("campo");
      const value = interaction.options.getString("valor");

      if (field === "color" && !/^#?[0-9a-f]{6}$/i.test(value)) {
        return interaction.reply({
          content: "Use uma cor hexadecimal, exemplo: #168FE5.",
          ephemeral: true
        });
      }

      if (field === "color") {
        db.ticketSettings.color = value.startsWith("#") ? value : `#${value}`;
      } else if (field === "thumbnailUrl") {
        if (!/^https?:\/\//i.test(value)) {
          return interaction.reply({
            content: "A URL precisa começar com https://",
            ephemeral: true
          });
        }

        db.ticketSettings.thumbnailUrl = value;
      } else {
        db.ticketSettings[field] = value;
      }

      saveDB();

      return interaction.reply({
        content: "✅ Configuração salva! Use /ticketpainel para publicar novamente.",
        ephemeral: true
      });
    }

    if (cmd === "ticketreset") {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "⛔ Você não pode restaurar o painel.",
          ephemeral: true
        });
      }

      db.ticketSettings = { ...defaultDB.ticketSettings };
      saveDB();

      return interaction.reply({
        content: "🔄 Painel restaurado para o padrão!",
        ephemeral: true
      });
    }

  } catch (error) {
    console.error("Erro no comando:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Ocorreu um erro. Tente novamente.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// BOTÕES E FORMULÁRIOS DOS TICKETS

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === "cart_add") {
      const product = findProduct(interaction.values[0]);

      if (!product || product.stock <= 0) {
        return interaction.reply({
          content: "Produto sem estoque.",
          ephemeral: true
        });
      }

      const cart = getCart(interaction.user.id);
      const item = cart.find(x => x.productId === product.id);

      if (item) {
        if (item.quantity >= product.stock) {
          return interaction.reply({
            content: "Você já colocou todo o estoque disponível no carrinho.",
            ephemeral: true
          });
        }

        item.quantity++;
      } else {
        cart.push({ productId: product.id, quantity: 1 });
      }

      saveDB();

      return interaction.reply({
        content: `🛒 ${product.name} foi adicionado ao carrinho!`,
        ephemeral: true
      });
    }

    if (interaction.isButton()) {
      if (interaction.customId === "ticket_buy") {
        return showTicketModal(interaction, "compra");
      }

      if (interaction.customId === "ticket_support") {
        return showTicketModal(interaction, "suporte");
      }

      if (interaction.customId === "ticket_staff") {
        return showTicketModal(interaction, "equipe");
      }

      if (interaction.customId === "ticket_close") {
        const ownerId = interaction.channel.topic?.replace("ticket-owner:", "");

        if (
          interaction.user.id !== ownerId &&
          !isStaff(interaction.member)
        ) {
          return interaction.reply({
            content: "⛔ Apenas quem abriu o ticket ou a equipe pode fechá-lo.",
            ephemeral: true
          });
        }

        await interaction.reply("🔒 Este ticket será fechado em alguns segundos.");

        setTimeout(() => {
          interaction.channel.delete().catch(() => {});
        }, 4000);

        return;
      }
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("ticket_form_")
    ) {
      const type = interaction.customId.replace("ticket_form_", "");
      const details = interaction.fields.getTextInputValue("details");

      const labels = {
        compra: "Compra de produtos",
        suporte: "Suporte",
        equipe: "Fale com a equipe"
      };

      return openTicket(
        interaction,
        labels[type] || "Atendimento",
        details
      );
    }

  } catch (error) {
    console.error("Erro nos tickets:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Não foi possível concluir essa ação.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// COMANDOS COM PREFIXO !

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  if (["!help", "!ajuda", "!pocoyo"].includes(command)) {
    const embed = new EmbedBuilder()
      .setColor("#168FE5")
      .setTitle("💙 Pocoyo Store — Ajuda")
      .setDescription(
        "**Comandos dos clientes**\n\n" +
        "`!help` — Mostra esta ajuda\n" +
        "`!catalogo` — Mostra os produtos\n" +
        "`!carrinho` — Mostra seu carrinho\n" +
        "`!comprar` — Finaliza sua compra\n" +
        "`!pedido ID` — Consulta seu pedido\n" +
        "`!cupom` — Mostra os cupons disponíveis\n" +
        "`!cupom NOME` — Aplica um cupom\n" +
        "`!calculadora VALOR PORCENTAGEM` — Calcula desconto\n\n" +
        "💙 Pagamento e entrega são realizados manualmente."
      );

    return message.reply({ embeds: [embed] });
  }

  if (["!catalogo", "!loja", "!produtos"].includes(command)) {
    const products = db.products.filter(p => p.stock > 0);

    if (!products.length) {
      return message.reply("Ainda não temos produtos disponíveis.");
    }

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#168FE5")
          .setTitle("💙 Catálogo Pocoyo Store")
          .setDescription(
            products.map(p =>
              `**#${p.id} — ${p.name}**\n` +
              `${p.description || "Sem descrição"}\n` +
              `${money(p.price)} • Estoque: ${p.stock}`
            ).join("\n\n")
          )
      ]
    });
  }

  if (["!carrinho", "!cart"].includes(command)) {
    const cart = getCart(message.author.id);

    if (!cart.length) {
      return message.reply("🛒 Seu carrinho está vazio.");
    }

    const lines = cart.map(item => {
      const p = findProduct(item.productId);

      return p
        ? `• ${p.name} x${item.quantity} — ${money(p.price * item.quantity)}`
        : "";
    }).filter(Boolean);

    return message.reply(
      `🛒 **Seu carrinho**\n${lines.join("\n")}\n**Total: ${money(totalCart(cart))}**`
    );
  }

  if (command === "!pedido") {
    const id = Number(args[1]);

    const order = db.orders.find(o =>
      o.id === id &&
      (o.userId === message.author.id || isStaff(message.member))
    );

    if (!order) {
      return message.reply("Pedido não encontrado ou você não tem acesso.");
    }

    return message.reply(
      `🧾 Pedido **#${order.id}**\n` +
      `Status: **${order.status}**\n` +
      `Total: ${money(order.total)}`
    );
  }

  if (command === "!comprar") {
    const cart = getCart(message.author.id);

    if (!cart.length) {
      return message.reply("Seu carrinho está vazio. Use !catalogo.");
    }

    for (const item of cart) {
      const p = findProduct(item.productId);

      if (!p || p.stock < item.quantity) {
        return message.reply("Estoque insuficiente para um dos produtos.");
      }
    }

    const order = {
      id: db.nextOrderId++,
      userId: message.author.id,
      items: cart.map(item => ({ ...item })),
      total: totalCart(cart),
      status: "Aguardando pagamento"
    };

    for (const item of cart) {
      findProduct(item.productId).stock -= item.quantity;
    }

    db.orders.push(order);
    db.carts[message.author.id] = [];
    saveDB();

    return message.reply(
      `💙 Pedido **#${order.id}** criado!\n` +
      `Total: **${money(order.total)}**\n` +
      `Pagamento e entrega serão feitos manualmente pela equipe.`
    );
  }

  if (command === "!cupom") {
    if (args[1]) {
      const name = args[1].toLowerCase();
      const coupon = db.coupons.find(c => c.name === name);

      if (!coupon) {
        return message.reply("❌ Cupom não encontrado.");
      }

      const cart = getCart(message.author.id);

      if (!cart.length) {
        return message.reply("Adicione produtos ao carrinho primeiro.");
      }

      const total = totalCart(cart);
      const discount = total * coupon.percent / 100;

      db.carts[message.author.id + "_coupon"] = name;
      saveDB();

      return message.reply(
        `🎟️ Cupom **${name}** aplicado!\n` +
        `Desconto: **${coupon.percent}%**\n` +
        `Total com desconto: **${money(total - discount)}**`
      );
    }

    if (!db.coupons.length) {
      return message.reply("No momento não há cupons disponíveis.");
    }

    return message.reply(
      "🎟️ **Cupons disponíveis**\n" +
      db.coupons.map(c => `• **${c.name}** — ${c.percent}% de desconto`).join("\n") +
      "\n\nPara aplicar: `!cupom NOME`"
    );
  }

  if (command === "!calculadora") {
    const value = parsePrice(args[1]);
    const percent = Number(args[2]);

    if (
      value === null ||
      !Number.isFinite(percent) ||
      percent < 0 ||
      percent > 100
    ) {
      return message.reply(
        "Use assim: `!calculadora 100 20` para calcular 20% de desconto em R$ 100."
      );
    }

    const discount = value * percent / 100;

    return message.reply(
      `🧮 **Calculadora Pocoyo**\n` +
      `Valor: ${money(value)}\n` +
      `Desconto: ${percent}% (${money(discount)})\n` +
      `**Total: ${money(value - discount)}**`
    );
  }
});

// LIGAR O BOT

client.login(TOKEN);
