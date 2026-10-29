# Pocoyo Store — Bot de vendas para Discord

Bot em Node.js + Discord.js 14, com catálogo, carrinho por usuário, pedidos persistentes em JSON, confirmação manual de pagamento e entrega manual. Também aceita comandos por palavra-chave com prefixo `!`.

## Requisitos
- Node.js 20 ou superior
- Uma aplicação/bot criado no Discord Developer Portal
- Um servidor Discord onde você tenha permissão para adicionar bots

## Instalação
1. Instale Node.js: https://nodejs.org/
2. Abra https://discord.com/developers/applications e crie uma aplicação chamada Pocoyo Store.
3. Na aba **Bot**, crie/adicione o bot e copie o token. Ative também **Message Content Intent** (em Privileged Gateway Intents), necessário para comandos começando com `!`. Nunca compartilhe o token.
4. Em **OAuth2 > URL Generator**, marque `bot` e `applications.commands`. Em permissões, selecione pelo menos `Send Messages`, `Embed Links`, `Use Application Commands` e `Read Message History`. Abra o link gerado e adicione o bot ao servidor.
5. Ative o **Developer Mode** no Discord e copie:
   - Application ID para `CLIENT_ID`
   - ID do servidor para `GUILD_ID`
6. Copie `.env.example` para `.env` e preencha `DISCORD_TOKEN`, `CLIENT_ID` e `GUILD_ID`.
   - Opcional: `ADMIN_ROLE_ID` para permitir também um cargo específico administrar a loja.
   - Opcional: `ORDERS_CHANNEL_ID` para anunciar pedidos em um canal privado da equipe.
   - Edite `PAYMENT_INSTRUCTIONS` com as instruções de pagamento.
7. No terminal, dentro da pasta do projeto, execute:
   ```bash
   npm install
   npm start
   ```
8. Quando o terminal mostrar que o bot está conectado, use `/adicionar` para cadastrar um produto, `/catalogo` para publicar o catálogo e `/painel` para publicar o painel (este comando exige permissão de administrador ou gerenciar servidor, ou o cargo configurado).

## Comandos por palavra-chave
Digite estes comandos em um canal de texto do servidor:
- `!pocoyo` — mostra a ajuda da loja
- `!catalogo` — publica o catálogo
- `!carrinho` — mostra seu carrinho
- `!pedido 1001` — consulta o pedido de número 1001 (troque pelo seu número)
- `!comprar` — explica como finalizar; para criar o pedido, use `/comprar`

Os comandos de administração e a finalização da compra continuam disponíveis pelos comandos `/`, que são mais seguros para preencher informações. Para que os comandos `!` funcionem, ative **Message Content Intent** na aba **Bot** do Discord Developer Portal.

## Como vender
1. Um administrador cadastra produtos com `/adicionar nome:... preco:19,90 estoque:10 descricao:...`.
2. Os clientes usam `/catalogo` e selecionam um produto no menu para adicioná-lo ao carrinho.
3. Usam `/carrinho` para ver os itens e `/comprar` para criar um pedido.
4. A equipe verifica o pagamento por conta própria e usa `/pago id:1001`.
5. A equipe realiza a entrega manual e usa `/entregar id:1001 detalhes:...`.
6. Use `/pedido id:1001` para consultar um pedido. A equipe pode usar `/pedidos`.

## Comandos da equipe
- `/adicionar`
- `/estoque`
- `/removerproduto`
- `/painel`
- `/pedidos`
- `/pago`
- `/entregar`
- `/cancelar`

A equipe precisa ter permissão **Administrador** ou **Gerenciar servidor**, ou o cargo configurado em `ADMIN_ROLE_ID`.

## Observações importantes
- Pagamento e entrega são manuais; o bot não verifica comprovantes nem movimenta dinheiro.
- Pedidos e produtos ficam em `data/store.json`. Faça backups periódicos.
- Use um canal privado para `ORDERS_CHANNEL_ID` e conceda acesso somente à equipe.
- Não coloque o token do bot em mensagens, prints ou repositórios públicos.
- O catálogo exibe até 10 produtos por mensagem e o seletor comporta até 25 opções. Para lojas maiores, será necessário implementar paginação.
- Para manter o bot online 24/7, execute-o em um computador/servidor que permaneça ligado ou em um serviço de hospedagem Node.js.
