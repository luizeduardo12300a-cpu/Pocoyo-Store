const {
  Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder,
  REST, Routes
} = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PREFIX = process.env.PREFIX || "!";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";
const TICKET_STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID || ADMIN_ROLE_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || "";
const ORDERS_CHANNEL_ID = process.env.ORDERS_CHANNEL_ID || "";
const FILE = path.join(__dirname, "pocoyo-data.json");

if (!TOKEN || ! CLIENT_ID || !GUILD_ID) {
  console.error("Configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID na FadeHost.");
  process.exit(1);
}
const blank = { products: [], coupons: [], carts: {}, orders: [], tickets: {} };
let db = blank;
try { if (fs.existsSync(FILE)) db = { ...blank, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch (e) { console.error(e); }
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
const money = n => (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const cents = n => Math.round(Number(String(n).replace(",", ".")) * 100);
const admin = m => !!m && (m.permissions?.has(PermissionsBitField.Flags.Administrator) || (!!ADMIN_ROLE_ID && m.roles?.cache?.has(ADMIN_ROLE_ID)));
const dm = async (user, text) => { try { await user.send(text); } catch { /* usuário pode bloquear DMs */ } };
const ephemeral = (i, content) => i.reply({ content, ephemeral: true });
const cart = id => db.carts[id] || (db.carts[id] = { items: [], coupon: null });
const couponByCode = code => db.coupons.find(c => c.code === code && c.active);
function totals(c) {
  const subtotal = c.items.reduce((s, x) => s + x.price * x.qty, 0);
  const cp = c.coupon && couponByCode(c.coupon);
  const discount = cp ? (cp.type === "percent" ? Math.round(subtotal * cp.value / 100) : Math.min(subtotal, cp.value)) : 0;
  return { subtotal, discount, total: subtotal - discount };
}
function cartInfo(c) {
  if (!c.items.length) return "Seu carrinho está vazio.";
  const t = totals(c);
  return c.items.map(x => `• ${x.name} × ${x.qty} — ${money(x.price * x.qty)}`).join("\n") +
    `\n\nSubtotal: ${money(t.subtotal)}\nDesconto: ${money(t.discount)}\n**Total: ${money(t.total)}**`;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

const slash = [
  new SlashCommandBuilder().setName("painel").setDescription("Painel da Pocoyo Store"),
  new SlashCommandBuilder().setName("catalogo").setDescription("Ver produtos"),
  new SlashCommandBuilder().setName("carrinho").setDescription("Ver carrinho"),
  new SlashCommandBuilder().setName("comprar").setDescription("Criar pedido"),
  new SlashCommandBuilder().setName("pedido").setDescription("Consultar pedidos"),
  new SlashCommandBuilder().setName("ticketpainel").setDescription("Publicar painel de tickets (equipe)"),
  new SlashCommandBuilder().setName("adicionar").setDescription("Adicionar produto (equipe)")
    .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
    .addNumberOption(o => o.setName("preco").setDescription("Preço em reais").setRequired(true).setMinValue(0.01))
    .addIntegerOption(o => o.setName("estoque").setDescription("Estoque").setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName("estoque").setDescription("Ver estoque (equipe)"),
  new SlashCommandBuilder().setName("removerproduto").setDescription("Remover produto (equipe)")
    .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true)),
  new SlashCommandBuilder().setName("pedidos").setDescription("Listar pedidos (equipe)"),
  ...["pago", "entregar", "cancelar"].map(n => new SlashCommandBuilder().setName(n).setDescription(`${n} pedido (equipe)`)
    .addIntegerOption(o => o.setName("id").setDescription("Número do pedido").setRequired(true)))
].map(x => x.toJSON());

async function privateReply(i, content, extra = {}) {
  if (i.deferred || i.replied) return i.followUp({ content, ephemeral: true, ...extra });
  return i.reply({ content, ephemeral: true, ...extra });
}
async function publishTicketPanel(channel) {
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle("🎫 Atendimento | Pocoyo Store")
    .setDescription("Clique em **CREATE TICKET** para abrir seu canal privado de atendimento.");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_create").setLabel("CREATE TICKET").setEmoji("🎫").setStyle(ButtonStyle.Success)
  );
  return channel.send({ embeds: [embed], components: [row] });
}
async function showTicketForm(i) {
  const modal = new ModalBuilder().setCustomId("ticket_form").setTitle("Solicitar atendimento");
  const fields = [
    ["nick", "Seu Nick", TextInputStyle.Short, true],
    ["items", "Itens desejados", TextInputStyle.Paragraph, true],
    ["quantity", "Quantidade", TextInputStyle.Short, true],
    ["notes", "Observações (opcional)", TextInputStyle.Paragraph, false]
  ];
  for (const [id, label, style, required] of fields) {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  await i.showModal(modal);

}
async function createTicket(i) {
  const existing = Object.values(db.tickets).find(t => t.guildId === i.guildId && t.userId === i.user.id && t.open);
  if (existing) return privateReply(i, `Você já tem um ticket aberto: <#${existing.channelId}>`);
  const perms = [
    { id: i.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
  ];
  if (TICKET_STAFF_ROLE_ID && i.guild.roles.cache.has(TICKET_STAFF_ROLE_ID))
    perms.push({ id: TICKET_STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
  const uname = i.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "cliente";
  const ch = await i.guild.channels.create({
    name: `ticket-${uname}`.slice(0, 90), type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID && i.guild.channels.cache.has(TICKET_CATEGORY_ID) ? TICKET_CATEGORY_ID : undefined,
    permissionOverwrites: perms
  });
  db.tickets[ch.id] = { guildId: i.guildId, userId: i.user.id, channelId: ch.id, open: true };
  save();
  const e = new EmbedBuilder().setColor(0x5865F2).setTitle("🎫 Novo atendimento")
    .setDescription(`Cliente: ${i.user}\n**Nick:** ${i.fields.getTextInputValue("nick")}\n**Itens desejados:** ${i.fields.getTextInputValue("items")}\n**Quantidade:** ${i.fields.getTextInputValue("quantity")}\n**Observações:** ${i.fields.getTextInputValue("notes") || "Nenhuma"}`);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_close").setLabel("FECHAR TICKET").setEmoji("🔒").setStyle(ButtonStyle.Danger));
  await ch.send({ content: `${i.user}${TICKET_STAFF_ROLE_ID ? ` <@&${TICKET_STAFF_ROLE_ID}>` : ""}`, embeds: [e], components: [row] });
  return privateReply(i, `✅ Ticket criado: ${ch}`);
}

client.once("ready", async () => {
  console.log(`Pocoyo Store conectado como ${client.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: slash });
    console.log("Comandos slash registrados.");
  } catch (e) { console.error("Erro registrando slash commands:", e); }
});

// Prefix commands respondem por DM; !help mostra somente comandos de clientes.
client.on("messageCreate", async m => {
  if (m.author.bot || !m.guild || !m.content.startsWith(PREFIX)) return;
  const a = m.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (a.shift() || "").toLowerCase();
  const replyDM = async text => {
    try { await m.author.send(text); }
    catch { await m.reply("Não consegui enviar DM. Ative as mensagens diretas deste servidor e tente novamente."); }
  };
  if (cmd === "help") return replyDM("🛍️ **POCOYO STORE — CLIENTES**\n!help — Ajuda\n!cupom — Listar cupons\n!cupom CÓDIGO — Aplicar cupom\n!calculadora VALOR PERCENTUAL — Calcular desconto\n/catalogo — Catálogo\n/carrinho — Carrinho\n/comprar — Fazer pedido\n/pedido — Consultar pedido");
  if (cmd === "cupom") {
    if (!a[0]) {
      const list = db.coupons.filter(c => c.active).map(c => `• ${c.code} — ${c.type === "percent" ? c.value + "%" : money(c.value)}`);
      return replyDM(list.length ? "🎟️ **Cupons ativos**\n" + list.join("\n") : "Não há cupons ativos.");
    }

      const code = a[0].toUpperCase(), cp = couponByCode(code);
    if (!cp) return replyDM("Cupom inválido ou inativo.");
    cart(m.author.id).coupon = code; save(); return replyDM(`✅ Cupom ${code} aplicado ao carrinho.`);
  }
  if (cmd === "calculadora") {
    const amount = cents(a[0]), pct = Number(a[1]);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(pct) || pct < 0 || pct > 100)
      return replyDM("Use: !calculadora VALOR PERCENTUAL\nExemplo: !calculadora 100 10");
    return replyDM(`Original: ${money(amount)}\nDesconto: ${pct}%\n**Total: ${money(Math.round(amount * (1 - pct / 100)))}**`);
  }
  if (cmd === "cupomadm") {
    if (!admin(m.member)) return replyDM("⛔ Comando exclusivo da equipe.");
    const sub = (a.shift() || "").toLowerCase();
    if (sub === "lista") return replyDM(db.coupons.length ? db.coupons.map(c => `${c.code} — ${c.type === "percent" ? c.value + "%" : money(c.value)} — ${c.active ? "ativo" : "inativo"}`).join("\n") : "Nenhum cupom cadastrado.");
    if (sub === "remover") {
      const code = (a[0] || "").toUpperCase(), ix = db.coupons.findIndex(c => c.code === code);
      if (ix < 0) return replyDM("Cupom não encontrado.");
      db.coupons.splice(ix, 1); save(); return replyDM(`Cupom ${code} removido.`);
    }
    if (sub === "criar") {
      const code = (a[0] || "").toUpperCase(), type = (a[1] || "").toLowerCase(), value = Number(String(a[2] || "").replace(",", "."));
      if (!/^[A-Z0-9_-]{3,30}$/.test(code) || !["percentual", "percent", "fixo"].includes(type) || !Number.isFinite(value) || value <= 0)
        return replyDM("Use: !cupomADM criar NOME percentual VALOR\nOu: !cupomADM criar NOME fixo VALOR");
      if (db.coupons.some(c => c.code === code)) return replyDM("Esse cupom já existe.");
      if (type !== "fixo" && value > 100) return replyDM("O percentual máximo é 100.");
      db.coupons.push({ code, type: type === "fixo" ? "fixed" : "percent", value: type === "fixo" ? cents(value) : value, active: true });
      save(); return replyDM(`✅ Cupom ${code} criado.`);
    }
    return replyDM("!cupomADM criar NOME percentual VALOR\n!cupomADM criar NOME fixo VALOR\n!cupomADM lista\n!cupomADM remover CÓDIGO");
  }
});

client.on("interactionCreate", async i => {
  try {
    if (i.isButton() && i.customId === "ticket_create") return showTicketForm(i);
    if (i.isButton() && i.customId === "ticket_close") {
      const t = db.tickets[i.channelId];
      const staff = admin(i.member) || (TICKET_STAFF_ROLE_ID && i.member.roles.cache.has(TICKET_STAFF_ROLE_ID));
      if (!t || !t.open) return privateReply(i, "Este ticket já está fechado.");
      if (i.user.id !== t.userId && !staff) return privateReply(i, "Você não pode fechar este ticket.");
      t.open = false; save(); await privateReply(i, "Ticket fechado. O canal será apagado em 5 segundos.");
      setTimeout(() => i.channel?.delete().catch(() => {}), 5000); return;
    }
    if (i.isModalSubmit() && i.customId === "ticket_form") return createTicket(i);
    if (!i.isChatInputCommand()) return;
    const n = i.commandName;
    if (n === "ticketpainel") {
      if (!admin(i.member)) return privateReply(i, "⛔ Somente a equipe pode publicar o painel.");
      await publishTicketPanel(i.channel); return privateReply(i, "Painel de tickets publicado!");

        }
    if (n === "painel") return privateReply(i, "🛍️ **POCOYO STORE**\nUse /catalogo para ver os produtos. Para atendimento, abra um ticket.", {
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_create").setLabel("CREATE TICKET").setEmoji("🎫").setStyle(ButtonStyle.Success))]
    });
    if (n === "catalogo") {
      const products = db.products.filter(p => p.stock > 0);
      return privateReply(i, products.length ? products.map(p => `• **${p.name}** — ${money(p.price)} (estoque ${p.stock})`).join("\n") : "Catálogo vazio.");
    }
    if (n === "carrinho") return privateReply(i, cartInfo(cart(i.user.id)));
    if (n === "comprar") {
      const c = cart(i.user.id);
      if (!c.items.length) return privateReply(i, "Carrinho vazio. Abra um ticket para solicitar ajuda.");
      const t = totals(c), id = db.orders.length ? db.orders[db.orders.length - 1].id + 1 : 1;
      db.orders.push({ id, userId: i.user.id, items: c.items, total: t.total, status: "Aguardando pagamento" });
      db.carts[i.user.id] = { items: [], coupon: null }; save();
      const ch = ORDERS_CHANNEL_ID && i.guild.channels.cache.get(ORDERS_CHANNEL_ID);
      if (ch) ch.send(`🧾 Pedido #${id} de ${i.user} — ${money(t.total)} — Aguardando pagamento`).catch(() => {});
      return privateReply(i, `✅ Pedido #${id} criado. Total: ${money(t.total)}.`);
    }
    if (n === "pedido") {
      const mine = db.orders.filter(o => o.userId === i.user.id);
      return privateReply(i, mine.length ? mine.map(o => `#${o.id} — ${o.status} — ${money(o.total)}`).join("\n") : "Você ainda não tem pedidos.");
    }
    const team = ["adicionar", "estoque", "removerproduto", "pedidos", "pago", "entregar", "cancelar"];
    if (team.includes(n)) {
      if (!admin(i.member)) return privateReply(i, "⛔ Comando exclusivo da equipe.");
      if (n === "adicionar") {
        const p = { name: i.options.getString("nome"), price: cents(i.options.getNumber("preco")), stock: i.options.getInteger("estoque") };
        db.products.push(p); save(); return privateReply(i, `Produto **${p.name}** adicionado.`);
      }
      if (n === "estoque") return privateReply(i, db.products.length ? db.products.map(p => `${p.name}: ${p.stock} unidades — ${money(p.price)}`).join("\n") : "Nenhum produto cadastrado.");
      if (n === "removerproduto") {
        const ix = db.products.findIndex(p => p.name.toLowerCase() === i.options.getString("nome").toLowerCase());
        if (ix < 0) return privateReply(i, "Produto não encontrado.");
        const p = db.products.splice(ix, 1)[0]; save(); return privateReply(i, `${p.name} removido.`);
      }
      if (n === "pedidos") return privateReply(i, db.orders.length ? db.orders.map(o => `#${o.id} — <@${o.userId}> — ${money(o.total)} — ${o.status}`).join("\n") : "Nenhum pedido.");
      const id = i.options.getInteger("id"), order = db.orders.find(o => o.id === id);
      if (!order) return privateReply(i, "Pedido não encontrado.");
      order.status = n === "pago" ? "Pago" : n === "entregar" ? "Entregue" : "Cancelado";
      save(); return privateReply(i, `Pedido #${id}: ${order.status}.`);
    }
  } catch (e) {
    console.error(e);
    if (i.isRepliable()) { try { await privateReply(i, "Ocorreu um erro. Confira o Console da FadeHost."); } catch {} }
  }
});

client.login(TOKEN);
