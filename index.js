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

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID no arquivo .env.");
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
      nextProductId: Number(d.nextProductId) || 1,
      nextOrderId: Number(d.nextOrderId) || 1001
    };
  } catch {
    return { products: [], orders: [], carts: {}, nextProductId: 1, nextOrderId: 1001 };
  }
}
let db = loadData();
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}
function money(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function parsePrice(input) {
  const normalized = String(input).trim().replace(/^R\$\s*/i, "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0.01 || n > 1000000) return null;
  return Math.round(n * 100);
}
function safeText(s, max = 100) {
  return String(s ?? "").replace(/[\r\n]/g, " ").trim().slice(0, max);
}
function isAdmin(interaction) {
  const member = interaction.member;
  const perms = member?.permissions;
  const hasPermission = perms?.has?.(PermissionFlagsBits.Administrator) || perms?.has?.(PermissionFlagsBits.ManageGuild);
  const hasRole = ADMIN_ROLE_ID && member?.roles?.cache?.has?.(ADMIN_ROLE_ID);
  return Boolean(hasPermission || hasRole);
}
async function adminOnly(interaction) {
  if (isAdmin(interaction)) return true;
  await interaction.reply({ content: "⛔ Este comando é exclusivo da equipe da loja.", ephemeral: true });
  return false;
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
    return { embeds: [new EmbedBuilder().setColor(0x36B7F4).setTitle("🩵 Pocoyo Store").setDescription("Ainda não há produtos cadastrados. A equipe pode usar `/adicionar`.")], components: [] };
  }
  const embeds = active.slice(0, 10).map(productEmbed);
  const options = active.filter(p => p.stock > 0).slice(0, 25).map(p => ({
    label: `${p.name}`.slice(0, 100),
    description: `${money(p.price)} • Estoque: ${p.stock}`.slice(0, 100),
    value: String(p.id)
  }));
  const components = options.length ? [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("store_add_to_cart")
      .setPlaceholder("Escolha um produto para adicionar ao carrinho")
      .addOptions(options)
  )] : [];
  return { content: "🛍️ **Catálogo da Pocoyo Store** — escolha um produto no menu para adicioná-lo ao carrinho.", embeds, components };
}
const commands = [
  new SlashCommandBuilder().setName("painel").setDescription("Publica o painel de vendas da Pocoyo Store"),
  new SlashCommandBuilder().setName("catalogo").setDescription("Mostra os produtos disponíveis"),
  new SlashCommandBuilder().setName("carrinho").setDescription("Mostra os itens do seu carrinho"),
  new SlashCommandBuilder().setName("comprar").setDescription("Cria um pedido com os itens do carrinho"),
  new SlashCommandBuilder().setName("pedido").setDescription("Consulta um pedido")
    .addIntegerOption(o => o.setName("id").setDescription("Número do pedido").setRequired(true)),
  new SlashCommandBuilder().setName("adicionar").setDescription("Cadastra um produto (equipe)")
    .addStringOption(o => o.setName("nome").setDescription("Nome do produto").setRequired(true).setMaxLength(80))
    .addStringOption(o => o.setName("preco").setDescription("Ex.: 19,90").setRequired(true))
    .addIntegerOption(o => o.setName("estoque").setDescription("Quantidade disponível").setRequired(true).setMinValue(0).setMaxValue(100000))
    .addStringOption(o => o.setName("descricao").setDescription("Descrição do produto").setRequired(false).setMaxLength(300)),
  new SlashCommandBuilder().setName("estoque").setDescription("Altera o estoque de um produto (equipe)")
    .addIntegerOption(o => o.setName("produto").setDescription("Código do produto").setRequired(true))
    .addIntegerOption(o => o.setName("quantidade").setDescription("Nova quantidade").setRequired(true).setMinValue(0).setMaxValue(100000)),
  new SlashCommandBuilder().setName("removerproduto").setDescription("Retira um produto do catálogo (equipe)")
    .addIntegerOption(o => o.setName("produto").setDescription("Código do produto").setRequired(true)),
  new SlashCommandBuilder().setName("pedidos").setDescription("Lista os pedidos recentes (equipe)"),
  new SlashCommandBuilder().setName("pago").setDescription("Marca pagamento como confirmado manualmente (equipe)")
    .addIntegerOption(o => o.setName("id").setDescription("Número do pedido").setRequired(true)),
  new SlashCommandBuilder().setName("entregar").setDescription("Marca pedido como entregue manualmente (equipe)")
    .addIntegerOption(o => o.setName("id").setDescription("Número do pedido").setRequired(true))
    .addStringOption(o => o.setName("detalhes").setDescription("Observação da entrega (opcional)").setRequired(false).setMaxLength(300)),
  new SlashCommandBuilder().setName("cancelar").setDescription("Cancela um pedido (equipe)")
    .addIntegerOption(o => o.setName("id").setDescription("Número do pedido").setRequired(true))
].map(c => c.toJSON());

const PREFIX = "!";
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Comandos slash registrados no servidor.");
}
function getCart(userId) {
  if (!Array.isArray(db.carts[userId])) db.carts[userId] = [];
  return db.carts[userId];
}
function cartSummary(userId) {
  const cart = getCart(userId);
  const lines = [];
  let total = 0;
  for (const item of cart) {
    const p = db.products.find(x => x.id === item.productId && x.active);
    if (!p) continue;
    const qty = Math.max(1, Number(item.quantity) || 1);
    total += p.price * qty;
    lines.push(`• **${p.name}** × ${qty} — ${money(p.price * qty)}`);
  }
  return { lines, total };
}
function findOrder(id) { return db.orders.find(o => o.id === id); }
function orderEmbed(order) {
  const status = { pending: "⏳ Aguardando pagamento", paid: "💰 Pagamento confirmado manualmente", delivered: "📦 Entregue", cancelled: "❌ Cancelado" }[order.status] || order.status;
  return new EmbedBuilder().setColor(0x36B7F4).setTitle(`🧾 Pedido #${order.id}`)
    .setDescription(order.items.map(i => `• ${i.name} × ${i.quantity} — ${money(i.price * i.quantity)}`).join("\n"))
    .addFields(
      { name: "Cliente", value: `<@${order.userId}>`, inline: true },
      { name: "Total", value: money(order.total), inline: true },
      { name: "Status", value: status, inline: false },
      { name: "Pagamento", value: "Manual", inline: true },
      { name: "Entrega", value: "Manual", inline: true }
    )
    .setFooter({ text: `Pocoyo Store • Criado em ${order.createdAt}` });
}
async function announceOrder(order) {
  if (!ORDERS_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(ORDERS_CHANNEL_ID);
    if (channel?.isTextBased()) await channel.send({ embeds: [orderEmbed(order)] });
  } catch (e) { console.error("Não consegui anunciar o pedido:", e.message); }
}

client.once("ready", () => console.log(`Pocoyo Store conectado como ${client.user.tag}`));

// Comandos por palavra-chave usando o prefixo !
client.on("messageCreate", async message => {
  try {
    if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = (args.shift() || "").toLowerCase();

    if (["pocoyo", "ajuda", "help"].includes(command)) {
      return message.reply({ embeds: [new EmbedBuilder().setColor(0x36B7F4)
        .setTitle("🩵 Pocoyo Store — Comandos")
        .setDescription("Bem-vindo à loja! Use os comandos abaixo:")
        .addFields(
          { name: "🛍️ Clientes", value: "`!catalogo` — ver produtos\n`!carrinho` — ver seu carrinho\n`!pedido NUMERO` — consultar seu pedido\n`/comprar` — finalizar compra" },
          { name: "🧸 Equipe", value: "Use os comandos com `/`: `/adicionar`, `/estoque`, `/removerproduto`, `/painel`, `/pedidos`, `/pago`, `/entregar` e `/cancelar`." }
        ).setFooter({ text: "Pocoyo Store • Pagamento e entrega manuais" })] });
    }
    if (["catalogo", "loja", "produtos"].includes(command)) {
      return message.channel.send(catalogPayload());
    }
    if (["carrinho", "cart"].includes(command)) {
      const { lines, total } = cartSummary(message.author.id);
      return message.reply(lines.length ? `🛒 **Seu carrinho**\n${lines.join("\n")}\n\n**Total: ${money(total)}**\nPara finalizar, use `/comprar`.` : "🛒 Seu carrinho está vazio. Use `!catalogo` para ver os produtos.");
    }
    if (command === "pedido") {
      const id = Number(args[0]);
      if (!Number.isInteger(id)) return message.reply("Use assim: `!pedido 1001`.");
      const order = findOrder(id);
      if (!order || (order.userId !== message.author.id && !message.member.permissions.has(PermissionFlagsBits.Administrator) && !message.member.permissions.has(PermissionFlagsBits.ManageGuild))) {
        return message.reply("Pedido não encontrado ou você não tem permissão para vê-lo.");
      }
      return message.channel.send({ embeds: [orderEmbed(order)] });
    }
    if (command === "comprar") return message.reply("Para finalizar com segurança, use o comando `/comprar` e siga as instruções de pagamento manual.");
    return message.reply(`Não conheço esse comando. Digite \`${PREFIX}pocoyo\` para ver a lista de comandos.`);
  } catch (error) {
    console.error("Erro no comando por prefixo:", error);
    message.reply("Ocorreu um erro ao executar esse comando.").catch(() => {});
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === "store_add_to_cart") {
      const productId = Number(interaction.values[0]);
      const product = db.products.find(p => p.id === productId && p.active);
      if (!product || product.stock < 1) {
        return interaction.reply({ content: "Esse produto está indisponível no momento.", ephemeral: true });
      }
      const cart = getCart(interaction.user.id);
      const existing = cart.find(i => i.productId === productId);
      if (existing) existing.quantity += 1;
      else cart.push({ productId, quantity: 1 });
      saveData();
      return interaction.reply({ content: `🩵 **${product.name}** foi adicionado ao seu carrinho. Use \`/carrinho\` para conferir.`, ephemeral: true });
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = interaction.commandName;

    if (cmd === "painel" || cmd === "catalogo") {
      if (cmd === "painel" && !await adminOnly(interaction)) return;
      return interaction.reply({ ...catalogPayload(), ephemeral: false });
    }

    if (cmd === "carrinho") {
      const { lines, total } = cartSummary(interaction.user.id);
      if (!lines.length) return interaction.reply({ content: "🛒 Seu carrinho está vazio. Use `/catalogo` para escolher produtos.", ephemeral: true });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cart_clear").setLabel("Esvaziar carrinho").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cart_checkout").setLabel("Criar pedido").setStyle(ButtonStyle.Primary)
      );
      return interaction.reply({ content: `🛒 **Seu carrinho**\n${lines.join("\n")}\n\n**Total: ${money(total)}**`, components: [row], ephemeral: true });
    }

    if (cmd === "comprar") {
      const cart = getCart(interaction.user.id);
      const { lines, total } = cartSummary(interaction.user.id);
      if (!lines.length) return interaction.reply({ content: "Seu carrinho está vazio. Use `/catalogo` primeiro.", ephemeral: true });
      for (const item of cart) {
        const p = db.products.find(x => x.id === item.productId && x.active);
        if (!p || p.stock < item.quantity) return interaction.reply({ content: `Estoque insuficiente para ${p?.name || "um produto"}.`, ephemeral: true });
      }
      const items = cart.map(item => {
        const p = db.products.find(x => x.id === item.productId);
        return { productId: p.id, name: p.name, price: p.price, quantity: item.quantity };
      });
      const order = {
        id: db.nextOrderId++, userId: interaction.user.id, guildId: interaction.guildId,
        items, total, status: "pending", createdAt: new Date().toLocaleString("pt-BR")
      };
      for (const item of items) {
        const p = db.products.find(x => x.id === item.productId);
        p.stock -= item.quantity;
      }
      db.orders.push(order);
      db.carts[interaction.user.id] = [];
      saveData();
      await interaction.reply({
        content: `🩵 Pedido **#${order.id}** criado!\n${lines.join("\n")}\n**Total: ${money(total)}**\n\n**Pagamento manual:** ${PAYMENT_INSTRUCTIONS}\nDepois de pagar, envie o comprovante à equipe. O pedido só será marcado como pago após a conferência de um administrador.`,
        embeds: [orderEmbed(order)], ephemeral: true
      });
      await announceOrder(order);
      return;
    }

    if (cmd === "pedido") {
      const id = interaction.options.getInteger("id", true);
      const order = findOrder(id);
      if (!order || (order.userId !== interaction.user.id && !isAdmin(interaction))) {
        return interaction.reply({ content: "Pedido não encontrado ou você não tem permissão para vê-lo.", ephemeral: true });
      }
      return interaction.reply({ embeds: [orderEmbed(order)], ephemeral: true });
    }

    if (cmd === "adicionar") {
      if (!await adminOnly(interaction)) return;
      const name = safeText(interaction.options.getString("nome", true), 80);
      const price = parsePrice(interaction.options.getString("preco", true));
      const stock = interaction.options.getInteger("estoque", true);
      const description = safeText(interaction.options.getString("descricao") || "", 300);
      if (!price) return interaction.reply({ content: "Preço inválido. Use, por exemplo, `19,90`.", ephemeral: true });
      const product = { id: db.nextProductId++, name, price, stock, description, active: true };
      db.products.push(product); saveData();
      return interaction.reply({ content: `✅ Produto cadastrado: **${name}** (#${product.id}) por ${money(price)}.`, ephemeral: true });
    }

    if (cmd === "estoque") {
      if (!await adminOnly(interaction)) return;
      const id = interaction.options.getInteger("produto", true);
      const stock = interaction.options.getInteger("quantidade", true);
      const product = db.products.find(p => p.id === id && p.active);
      if (!product) return interaction.reply({ content: "Produto não encontrado.", ephemeral: true });
      product.stock = stock; saveData();
      return interaction.reply({ content: `📦 Estoque de **${product.name}** atualizado para ${stock}.`, ephemeral: true });
    }

    if (cmd === "removerproduto") {
      if (!await adminOnly(interaction)) return;
      const id = interaction.options.getInteger("produto", true);
      const product = db.products.find(p => p.id === id && p.active);
      if (!product) return interaction.reply({ content: "Produto não encontrado.", ephemeral: true });
      product.active = false; saveData();
      return interaction.reply({ content: `🗑️ **${product.name}** foi retirado do catálogo.`, ephemeral: true });
    }

    if (cmd === "pedidos") {
      if (!await adminOnly(interaction)) return;
      const orders = db.orders.slice(-10).reverse();
      if (!orders.length) return interaction.reply({ content: "Ainda não há pedidos.", ephemeral: true });
      return interaction.reply({ embeds: orders.map(orderEmbed), ephemeral: true });
    }

    if (cmd === "pago") {
      if (!await adminOnly(interaction)) return;
      const id = interaction.options.getInteger("id", true);
      const order = findOrder(id);
      if (!order) return interaction.reply({ content: "Pedido não encontrado.", ephemeral: true });
      if (order.status === "cancelled") return interaction.reply({ content: "Não é possível confirmar pagamento de um pedido cancelado.", ephemeral: true });
      if (order.status === "delivered") return interaction.reply({ content: "Este pedido já foi entregue.", ephemeral: true });
      order.status = "paid"; order.paidAt = new Date().toLocaleString("pt-BR"); order.paidBy = interaction.user.id;
      saveData();
      await interaction.reply({ content: `💰 Pagamento do pedido **#${id}** confirmado manualmente.`, ephemeral: true });
      try {
        const user = await client.users.fetch(order.userId);
        await user.send(`🩵 A equipe confirmou o pagamento do seu pedido **#${id}** na Pocoyo Store. A entrega será feita manualmente.`);
      } catch {}
      return;
    }

    if (cmd === "entregar") {
      if (!await adminOnly(interaction)) return;
      const id = interaction.options.getInteger("id", true);
      const details = safeText(interaction.options.getString("detalhes") || "", 300);
      const order = findOrder(id);
      if (!order) return interaction.reply({ content: "Pedido não encontrado.", ephemeral: true });
      if (order.status !== "paid") return interaction.reply({ content: "Confirme o pagamento com `/pago` antes de marcar como entregue.", ephemeral: true });
      order.status = "delivered"; order.deliveredAt = new Date().toLocaleString("pt-BR");
      order.deliveredBy = interaction.user.id; order.deliveryDetails = details;
      saveData();
      await interaction.reply({ content: `📦 Pedido **#${id}** marcado como entregue.`, ephemeral: true });
      try {
        const user = await client.users.fetch(order.userId);
        await user.send(`🎉 Seu pedido **#${id}** da Pocoyo Store foi entregue pela equipe!${details ? `\nDetalhes: ${details}` : ""}`);
      } catch {}
      return;
    }

    if (cmd === "cancelar") {
      if (!await adminOnly(interaction)) return;
      const id = interaction.options.getInteger("id", true);
      const order = findOrder(id);
      if (!order) return interaction.reply({ content: "Pedido não encontrado.", ephemeral: true });
      if (order.status === "delivered") return interaction.reply({ content: "Um pedido entregue não pode ser cancelado por este comando.", ephemeral: true });
      if (order.status === "cancelled") return interaction.reply({ content: "Este pedido já está cancelado.", ephemeral: true });
      order.status = "cancelled"; order.cancelledAt = new Date().toLocaleString("pt-BR");
      // Devolve o estoque ao cancelar um pedido ainda não entregue.
      for (const item of order.items) {
        const p = db.products.find(x => x.id === item.productId);
        if (p) p.stock += item.quantity;
      }
      saveData();
      return interaction.reply({ content: `❌ Pedido **#${id}** cancelado e estoque devolvido.`, ephemeral: true });
    }
  } catch (error) {
    console.error("Erro ao processar interação:", error);
    const msg = { content: "Ocorreu um erro. Confira o console do bot e tente novamente.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isButton()) return;
    if (interaction.customId === "cart_clear") {
      db.carts[interaction.user.id] = [];
      saveData();
      return interaction.update({ content: "🛒 Carrinho esvaziado.", components: [], embeds: [] });
    }
    if (interaction.customId === "cart_checkout") {
      return interaction.reply({ content: "Use `/comprar` para confirmar seu pedido e receber as instruções de pagamento.", ephemeral: true });
    }
  } catch (error) {
    console.error("Erro no botão:", error);
  }
});

registerCommands().then(() => client.login(TOKEN)).catch(error => {
  console.error("Não foi possível registrar os comandos ou conectar o bot:", error);
  process.exit(1);
});
