# Arena Maker V3 — sem login

Montador de campeonatos com cadastro visual de jogadores, formatos Liga, Mata-mata e Misto, equipes, confrontos sorteados e estatísticas individuais.

## Mudança principal

O sistema abre diretamente. Não existe conta, Magic Link, confirmação de e-mail ou botão de sair.

Os jogadores e campeonatos são salvos no Supabase usando a Publishable Key. A Secret Key do Supabase não é necessária nesta versão.

A publicação de ZIP no GitHub pede apenas um código de publicação. Esse código fica salvo como `PUBLISH_SECRET` nas variáveis protegidas da Vercel e não fica no HTML.

## Configuração rápida

1. Substitua os arquivos do repositório pelos arquivos deste ZIP.
2. No Supabase, abra **SQL Editor**, cole todo o arquivo `supabase/schema.sql` e clique em **Run**.
3. Na Vercel, mantenha:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. A variável `SUPABASE_SERVICE_ROLE_KEY` pode ser apagada; ela não é usada.
5. Para o importador, mantenha as variáveis da GitHub App e crie:
   - `PUBLISH_SECRET`
6. Faça um novo deploy.

## Atenção sobre acesso

Como você pediu o sistema sem login, qualquer pessoa que descubra a URL do site poderá abrir o Arena Maker e alterar os campeonatos. O código de publicação protege apenas os commits no GitHub.
