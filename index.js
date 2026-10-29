require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";
const ORDERS_CHANNEL_ID = process.env.ORDERS_CHANNEL_ID || "";
const PAYMENT_INSTRUCTIONS = process.env.PAYMENT_INSTRUCTIONS || "Combine o pagamento com a equipe da loja.";
const PREFIX = "!";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID nas variáveis de ambiente.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      products: Array.isArray(d.products) ? d.products : [],
      orders: Array.isArray(d.orders) ? d.orders : [],
      carts: d.carts && typeof d.carts === "object" ? d.carts : {},
      cartCoupons: d.cartCoupons && typeof d.cartCoupons === "object" ? d.cartCoupons : {},
      coupons: Array.isArray(d.coupons) ? d.coupons : [],
      nextProductId: Number(d.nextProductId) || 1,
      nextOrderId: Number(d.nextOrderId) || 1001
    };
  } catch {
    return {
      products: [], orders: [], carts: {},
      cartCoupons: {}, coupons: [],
      nextProductId: 1, nextOrderId: 1001
    };
  }
}

let db = loadData();
if (!Array.isArray(db.coupons)) db.coupons = [];

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

function money(cents) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL"
  });
}

function parsePrice(input) {
  const normalized = String(input).trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0.01 || n > 1000000) return null;
  return Math.round(n * 100);
}

function safeText(s, max = 100) {
  return String(s ?? "").replace(/[\r\n]/g, " ").trim().slice(0, max);
}

function isAdmin(member) {
  const perms = member?.permissions;
  const hasPermission =
    perms?.has?.(PermissionFlagsBits.Administrator) ||
    perms?.has?.(PermissionFlagsBits.ManageGuild);
  const hasRole =
    ADMIN_ROLE_ID && member?.roles?.cache?.has?.(ADMIN_ROLE_ID);
  return Boolean(hasPermission || hasRole);
}

async function adminOnly(interaction) {
  if (isAdmin(interaction.member)) return true;
  await interaction.reply({
    content: "⛔ Este comando é exclusivo da equipe da loja.",
    ephemeral: true
  });
  return false;
}

function validCoupon(code) {
  return db.coupons.find(c =>
    c.code.toLowerCase() === String(code).toLowerCase() && c.active
  );
}

function discountFor(total, coupon) {
  if (!coupon || total <= 0) return 0;
  if (coupon.type === "percent") {
    return Math.min(total, Math.round(total * coupon.value / 100));
  }
  return Math.min(total, coupon.value);
}

function getCart(userId) {
  if (!Array.isArray(db.carts[userId])) db.carts[userId] = [];
  return db.carts[userId];
}

function cartSummary(userId) {
  const cart = getCart(userId);
  const lines = [];
  let subtotal = 0;

  for (const item of cart) {
    const p = db.products.find(x => x.id === item.productId && x.active);
    if (!p) continue;

    const qty = Math.max(1, Number(item.quantity) || 1);
    subtotal += p.price * qty;
    lines.push(`• **${p.name}** × ${qty} — ${money(p.price * qty)}`);
  }

  const code = db.cartCoupons[userId];
  const coupon = code ? validCoupon(code) : null;
  const discount = discountFor(subtotal, coupon);

  return { lines, subtotal, coupon, discount, total: subtotal - discount };
}

function productEmbed(product) {
  return new EmbedBuilder()
    .setColor(0x36B7F4)
    .setTitle(`🩵 ${product.name}`)
    .setDescription(product.description || "Um produto especial da Pocoyo Store!")
    .addFields(
      { name: "Preço", value: money(product.price), inline: true },
      { name: "Estoque", value: String(product.stock), inline: true },
      { name: "Código", value: `#${product.id}`, inline: true }
    )
    .setFooter({ text: "Pocoyo Store • Pagamento e entrega manuais" });
}

function catalogPayload() {
  const active = db.products.filter(p => p.active);

  if (!active.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x36B7F4)
          .setTitle("🩵 Pocoyo Store")
          .setDescription("Ainda não há produtos cadastrados.")
      ],
      components: []
    };
  }

  const embeds = active.slice(0, 10).map(productEmbed);
  const options = active.filter(p => p.stock > 0).slice(0, 25).map(p => ({
    label: p.name.slice(0, 100),
    description: `${money(p.price)} • Estoque: ${p.stock}`.slice(0, 100),
    value: String(p.id)
  }));

  const components = options.length
    ? [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("store_add_to_cart")
          .setPlaceholder("Escolha um produto para adicionar ao carrinho")
          .addOptions(options)
      )]
    : [];

  return {
    content: "🛍️ **Catálogo da Pocoyo Store**",
    embeds,
    components
  };
}

function orderEmbed(order) {
  const status = {
    pending: "⏳ Aguardando pagamento",
    paid: "💰 Pagamento confirmado",
    delivered: "📦 Entregue",
    cancelled: "❌ Cancelado"
  }[order.status] || order.status;

  return new EmbedBuilder()
    .setColor(0x36B7F4)
    .setTitle(`🧾 Pedido #${order.id}`)
    .setDescription(
      order.items.map(i =>
        `• ${i.name} × ${i.quantity} — ${money(i.price * i.quantity)}`
      ).join("\n")
    )
    .addFields(
      { name: "Cliente", value: `<@${order.userId}>`, inline: true },
      { name: "Total", value: money(order.total), inline: true },
      { name: "Status", value: status, inline: false }
    )
    .setFooter({ text: `Pocoyo Store • ${order.createdAt}` });
}

function findOrder(id) {
  return db.orders.find(o => o.id === id);
}

async function announceOrder(order, client) {
  if (!ORDERS_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(ORDERS_CHANNEL_ID);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [orderEmbed(order)] });
    }
  } catch (error) {
    console.error("Erro ao anunciar pedido:", error.message);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Publica o painel da loja"),

  new SlashCommandBuilder()
    .setName("catalogo")
    .setDescription("Mostra os produtos disponíveis"),

  new SlashCommandBuilder()
    .setName("carrinho")
    .setDescription("Mostra seu carrinho"),

  new SlashCommandBuilder()
    .setName("comprar")
    .setDescription("Finaliza a compra"),

  new SlashCommandBuilder()
    .setName("pedido")
    .setDescription("Consulta um pedido")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("adicionar")
    .setDescription("Cadastra um produto (equipe)")
    .addStringOption(o =>
      o.setName("nome")
        .setDescription("Nome do produto")
        .setRequired(true)
        .setMaxLength(80)
    )
    .addStringOption(o =>
      o.setName("preco")
        .setDescription("Exemplo: 19,90")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("estoque")
        .setDescription("Quantidade disponível")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100000)
    )
    .addStringOption(o =>
      o.setName("descricao")
        .setDescription("Descrição do produto")
        .setRequired(false)
        .setMaxLength(300)
    ),

  new SlashCommandBuilder()
    .setName("estoque")
    .setDescription("Altera o estoque (equipe)")
    .addIntegerOption(o =>
      o.setName("produto")
        .setDescription("Código do produto")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("quantidade")
        .setDescription("Nova quantidade")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100000)
    ),

  new SlashCommandBuilder()
    .setName("removerproduto")
    .setDescription("Retira um produto do catálogo (equipe)")
    .addIntegerOption(o =>
      o.setName("produto")
        .setDescription("Código do produto")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("pedidos")
    .setDescription("Lista os pedidos recentes (equipe)"),

  new SlashCommandBuilder()
    .setName("pago")
    .setDescription("Confirma o pagamento (equipe)")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("entregar")
    .setDescription("Marca um pedido como entregue (equipe)")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("detalhes")
        .setDescription("Detalhes da entrega")
        .setRequired(false)
        .setMaxLength(300)
    ),

  new SlashCommandBuilder()
    .setName("cancelar")
    .setDescription("Cancela um pedido (equipe)")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Número do pedido")
        .setRequired(true)
    )
].map(c => c.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Comandos registrados no servidor.");
}

client.once("ready", async () => {
  console.log(`Pocoyo Store conectado como ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Erro ao registrar comandos:", error);
  }
});

client.on("messageCreate", async message => {
  try {
    if (
      message.author.bot ||
      !message.guild ||
      !message.content.startsWith(PREFIX)
    ) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = (args.shift() || "").toLowerCase();

    // Ajuda pública: somente comandos de clientes
    if (["help", "ajuda", "pocoyo"].includes(command)) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x36B7F4)
            .setTitle("🩵 Pocoyo Store — Ajuda")
            .setDescription("Comandos disponíveis para clientes:")
            .addFields({
              name: "🛍️ Compras",
              value:
                "`!catalogo` — ver produtos\n" +
                "`!carrinho` — ver seu carrinho\n" +
                "`!pedido NUMERO` — consultar pedido\n" +
                "`!cupom` — ver cupons ativos\n" +
                "`!cupom CODIGO` — aplicar cupom\n" +
                "`!calculadora VALOR DESCONTO` — calcular desconto\n" +
                "Use `/comprar` para finalizar a compra."
            })
            .setFooter({ text: "Pocoyo Store 🩵" })
        ]
      });
    }

    if (["catalogo", "loja", "produtos"].includes(command)) {
      return message.channel.send(catalogPayload());
    }

    if (["carrinho", "cart"].includes(command)) {
      const s = cartSummary(message.author.id);

      return message.reply(
        s.lines.length
          ? `🛒 **Seu carrinho**\n${s.lines.join("\n")}\n` +
            `\nSubtotal: ${money(s.subtotal)}` +
            `\nDesconto: ${money(s.discount)}` +
            `\n**Total: ${money(s.total)}**`
          : "🛒 Seu carrinho está vazio. Use `!catalogo`."
      );
    }

    if (command === "pedido") {
      const id = Number(args[0]);
      const order = findOrder(id);

      if (
        !order ||
        (order.userId !== message.author.id && !isAdmin(message.member))
      ) {
        return message.reply(
          "Pedido não encontrado ou você não tem permissão para vê-lo."
        );
      }

      return message.channel.send({ embeds: [orderEmbed(order)] });
    }

    if (command === "cupom") {
      if (!args.length) {
        const active = db.coupons.filter(c => c.active);

        return message.reply(
          active.length
            ? "🎟️ **Cupons ativos**\n" +
              active.map(c =>
                `• **${c.code}** — ${
                  c.type === "percent"
                    ? `${c.value}% de desconto`
                    : `${money(c.value)} de desconto`
                }`
              ).join("\n") +
              "\nPara aplicar, use `!cupom CODIGO`."
            : "No momento não há cupons ativos."
        );
      }

      const coupon = validCoupon(args[0].toUpperCase());

      if (!coupon) {
        return message.reply("❌ Cupom inválido ou inativo.");
      }

      const cart = getCart(message.author.id);

      if (!cart.length) {
        return message.reply("Seu carrinho está vazio. Escolha produtos primeiro.");
      }

      db.cartCoupons[message.author.id] = coupon.code;
      saveData();

      const s = cartSummary(message.author.id);

      return message.reply(
        `✅ Cupom **${coupon.code}** aplicado!\n` +
        `Desconto: ${money(s.discount)}\n` +
        `**Total com desconto: ${money(s.total)}**`
      );
    }

    if (command === "cupomadm") {
      if (!isAdmin(message.member)) {
        return message.reply("⛔ Comando exclusivo da equipe.");
      }

      const action = (args[0] || "").toLowerCase();

      if (action === "lista") {
        return message.reply(
          db.coupons.length
            ? db.coupons.map(c =>
                `• ${c.code} — ${
                  c.type === "percent"
                    ? `${c.value}%`
                    : money(c.value)
                } — ${c.active ? "Ativo" : "Inativo"}`
              ).join("\n")
            : "Nenhum cupom cadastrado."
        );
      }

      if (action === "remover") {
        const code = (args[1] || "").toUpperCase();
        const coupon = db.coupons.find(c => c.code === code);

        if (!coupon) return message.reply("Cupom não encontrado.");

        coupon.active = false;
        saveData();

        return message.reply(`🗑️ Cupom **${code}** desativado.`);
      }

      if (action === "criar") {
        const code = (args[1] || "").toUpperCase();
        const type = (args[2] || "").toLowerCase();
        const value = Number((args[3] || "").replace(",", "."));

        if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
          return message.reply(
            "Use um código de 3 a 30 letras, números, _ ou -."
          );
        }

        if (!["percentual", "fixo"].includes(type)) {
          return message.reply(
            "Use: `!cupomADM criar CODIGO percentual VALOR` ou `!cupomADM criar CODIGO fixo VALOR`."
          );
        }

        if (!Number.isFinite(value) || value <= 0) {
          return message.reply("Informe um valor válido maior que zero.");
        }

        if (type === "percentual" && value > 100) {
          return message.reply("O desconto percentual máximo é 100.");
        }

        if (db.coupons.some(c => c.code === code)) {
          return message.reply("Já existe um cupom com esse código.");
        }

        db.coupons.push({
          code,
          type: type === "percentual" ? "percent" : "fixed",
          value: type === "percentual"
            ? value
            : parsePrice(String(value).replace(".", ",")),
          active: true
        });

        const created = db.coupons[db.coupons.length - 1];

        if (!created.value) {
          db.coupons.pop();
          return message.reply("Valor fixo inválido. Exemplo: `!cupomADM criar TESTE fixo 5,00`.");
        }

        saveData();

        return message.reply(`✅ Cupom **${code}** criado com sucesso.`);
      }

      return message.reply(
        "Comandos: `!cupomADM criar`, `!cupomADM lista` e `!cupomADM remover`."
      );
    }

    if (command === "calculadora") {
      const price = parsePrice(args[0] || "");
      const percent = Number((args[1] || "").replace(",", "."));

      if (
        price === null ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        return message.reply(
          "Use: `!calculadora 50,00 10` para calcular 10% de desconto em R$ 50,00."
        );
      }

      const discount = Math.round(price * percent / 100);

      return message.reply(
        `🧮 **Calculadora de desconto**\n` +
        `Preço original: ${money(price)}\n` +
        `Desconto: ${percent}% (${money(discount)})\n` +
        `**Preço final: ${money(price - discount)}**`
      );
    }

    if (command === "comprar") {
      return message.reply("Para finalizar, use `/comprar`.");
    }

  } catch (error) {
    console.error("Erro nos comandos de texto:", error);
    message.reply("Ocorreu um erro ao executar o comando.").catch(() => {});
  }
});
client.on("interactionCreate", async interaction => {
  try {
    // Menu de produtos: adicionar ao carrinho
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "store_add_to_cart"
    ) {
      const productId = Number(interaction.values[0]);
      const product = db.products.find(
        p => p.id === productId && p.active
      );

      if (!product || product.stock < 1) {
        return interaction.reply({
          content: "Produto indisponível no momento.",
          ephemeral: true
        });
      }

      const cart = getCart(interaction.user.id);
      const existing = cart.find(i => i.productId === productId);

      if (existing) {
        if (existing.quantity >= product.stock) {
          return interaction.reply({
            content: "Você já adicionou todo o estoque disponível.",
            ephemeral: true
          });
        }
        existing.quantity += 1;
      } else {
        cart.push({ productId, quantity: 1 });
      }

      saveData();

      return interaction.reply({
        content: `🩵 **${product.name}** foi adicionado ao carrinho!`,
        ephemeral: true
      });
    }

    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;

    if (cmd === "painel" || cmd === "catalogo") {
      if (cmd === "painel" && !await adminOnly(interaction)) return;

      return interaction.reply({
        ...catalogPayload()
      });
    }

    if (cmd === "carrinho") {
      const s = cartSummary(interaction.user.id);

      if (!s.lines.length) {
        return interaction.reply({
          content: "🛒 Seu carrinho está vazio. Use `/catalogo`.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content:
          `🛒 **Seu carrinho**\n${s.lines.join("\n")}\n\n` +
          `Subtotal: ${money(s.subtotal)}\n` +
          `Desconto: ${money(s.discount)}\n` +
          `**Total: ${money(s.total)}**`,
        ephemeral: true
      });
    }

    if (cmd === "comprar") {
      const cart = getCart(interaction.user.id);
      const s = cartSummary(interaction.user.id);

      if (!s.lines.length) {
        return interaction.reply({
          content: "Seu carrinho está vazio. Use `/catalogo`.",
          ephemeral: true
        });
      }

      for (const item of cart) {
        const p = db.products.find(
          x => x.id === item.productId && x.active
        );

        if (!p || p.stock < item.quantity) {
          return interaction.reply({
            content: `Estoque insuficiente para ${p?.name || "um produto"}.`,
            ephemeral: true
          });
        }
      }

      const items = cart.map(item => {
        const p = db.products.find(x => x.id === item.productId);

        return {
          productId: p.id,
          name: p.name,
          price: p.price,
          quantity: item.quantity
        };
      });

      const order = {
        id: db.nextOrderId++,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        items,
        subtotal: s.subtotal,
        discount: s.discount,
        coupon: s.coupon?.code || null,
        total: s.total,
        status: "pending",
        createdAt: new Date().toLocaleString("pt-BR")
      };

      for (const item of items) {
        const p = db.products.find(x => x.id === item.productId);
        p.stock -= item.quantity;
      }

      db.orders.push(order);
      db.carts[interaction.user.id] = [];
      delete db.cartCoupons[interaction.user.id];
      saveData();

      await interaction.reply({
        content:
          `🩵 Pedido **#${order.id}** criado!\n` +
          `Subtotal: ${money(s.subtotal)}\n` +
          `Desconto: ${money(s.discount)}\n` +
          `**Total: ${money(s.total)}**\n\n` +
          `**Pagamento manual:** ${PAYMENT_INSTRUCTIONS}\n` +
          `Envie o comprovante à equipe. O pagamento será confirmado após conferência.`,
        ephemeral: true
      });

      await announceOrder(order, client);
      return;
    }

    if (cmd === "pedido") {
      const id = interaction.options.getInteger("id", true);
      const order = findOrder(id);

      if (
        !order ||
        (order.userId !== interaction.user.id && !isAdmin(interaction.member))
      ) {
        return interaction.reply({
          content: "Pedido não encontrado ou acesso não permitido.",
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [orderEmbed(order)],
        ephemeral: true
      });
    }

    if (cmd === "adicionar") {
      if (!await adminOnly(interaction)) return;

      const name = safeText(interaction.options.getString("nome", true), 80);
      const price = parsePrice(interaction.options.getString("preco", true));
      const stock = interaction.options.getInteger("estoque", true);
      const description = safeText(
        interaction.options.getString("descricao") || "", 300
      );

      if (price === null) {
        return interaction.reply({
          content: "Preço inválido. Exemplo: `19,90`.",
          ephemeral: true
        });
      }

      const product = {
        id: db.nextProductId++,
        name,
        price,
        stock,
        description,
        active: true
      };

      db.products.push(product);
      saveData();

      return interaction.reply({
        content: `✅ Produto **${name}** cadastrado por ${money(price)}.`,
        ephemeral: true
      });
    }

    if (cmd === "estoque") {
      if (!await adminOnly(interaction)) return;

      const id = interaction.options.getInteger("produto", true);
      const stock = interaction.options.getInteger("quantidade", true);
      const product = db.products.find(p => p.id === id && p.active);

      if (!product) {
        return interaction.reply({
          content: "Produto não encontrado.",
          ephemeral: true
        });
      }

      product.stock = stock;
      saveData();

      return interaction.reply({
        content: `📦 Estoque de **${product.name}** atualizado: ${stock}.`,
        ephemeral: true
      });
    }

    if (cmd === "removerproduto") {
      if (!await adminOnly(interaction)) return;

      const id = interaction.options.getInteger("produto", true);
      const product = db.products.find(p => p.id === id && p.active);

      if (!product) {
        return interaction.reply({
          content: "Produto não encontrado.",
          ephemeral: true
        });
      }

      product.active = false;
      saveData();

      return interaction.reply({
        content: `🗑️ **${product.name}** foi retirado do catálogo.`,
        ephemeral: true
      });
    }

    if (cmd === "pedidos") {
      if (!await adminOnly(interaction)) return;

      const orders = db.orders.slice(-10).reverse();

      if (!orders.length) {
        return interaction.reply({
          content: "Ainda não há pedidos.",
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: orders.map(orderEmbed),
        ephemeral: true
      });
    }

    if (cmd === "pago") {
      if (!await adminOnly(interaction)) return;

      const id = interaction.options.getInteger("id", true);
      const order = findOrder(id);

      if (!order) {
        return interaction.reply({
          content: "Pedido não encontrado.",
          ephemeral: true
        });
      }

      if (order.status !== "pending") {
        return interaction.reply({
          content: "Este pedido não está aguardando pagamento.",
          ephemeral: true
        });
      }

      order.status = "paid";
      order.paidAt = new Date().toLocaleString("pt-BR");
      order.paidBy = interaction.user.id;
      saveData();

      await interaction.reply({
        content: `💰 Pagamento do pedido #${id} confirmado.`,
        ephemeral: true
      });

      try {
        const user = await client.users.fetch(order.userId);
        await user.send(
          `🩵 O pagamento do seu pedido #${id} foi confirmado pela Pocoyo Store!`
        );
      } catch {}

      return;
    }

    if (cmd === "entregar") {
      if (!await adminOnly(interaction)) return;

      const id = interaction.options.getInteger("id", true);
      const details = safeText(
        interaction.options.getString("detalhes") || "", 300
      );
      const order = findOrder(id);

      if (!order) {
        return interaction.reply({
          content: "Pedido não encontrado.",
          ephemeral: true
        });
      }

      if (order.status !== "paid") {
        return interaction.reply({
          content: "Confirme o pagamento com `/pago` primeiro.",
          ephemeral: true
        });
      }

      order.status = "delivered";
      order.deliveredAt = new Date().toLocaleString("pt-BR");
      order.deliveredBy = interaction.user.id;
      order.deliveryDetails = details;
      saveData();

      await interaction.reply({
        content: `📦 Pedido #${id} marcado como entregue.`,
        ephemeral: true
      });

      try {
        const user = await client.users.fetch(order.userId);
        await user.send(
          `🎉 Seu pedido #${id} da Pocoyo Store foi entregue!` +
          (details ? `\nDetalhes: ${details}` : "")
        );
      } catch {}

      return;
    }

    if (cmd === "cancelar") {
      if (!await adminOnly(interaction)) return;

      const id = interaction.options.getInteger("id", true);
      const order = findOrder(id);

      if (!order) {
        return interaction.reply({
          content: "Pedido não encontrado.",
          ephemeral: true
        });
      }

      if (["cancelled", "delivered"].includes(order.status)) {
        return interaction.reply({
          content: "Este pedido já foi cancelado ou entregue.",
          ephemeral: true
        });
      }

      order.status = "cancelled";
      order.cancelledAt = new Date().toLocaleString("pt-BR");

      // Devolve o estoque dos produtos do pedido
      for (const item of order.items) {
        const p = db.products.find(x => x.id === item.productId);

        if (p) p.stock += item.quantity;
      }

      saveData();

      return interaction.reply({
        content: `❌ Pedido #${id} cancelado e estoque devolvido.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Erro na interação:", error);

    const response = {
      content: "Ocorreu um erro. Tente novamente ou avise a equipe.",
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

client.login(TOKEN);
