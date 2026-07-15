# Arena Maker V2

Montador profissional de campeonatos em HTML/JavaScript, com cadastro permanente de jogadores, campeonatos individuais ou por equipes, formatos Liga, Mata-mata e Misto, estatísticas individuais, Supabase e publicação automática de ZIP no GitHub.

## O que mudou

- Jogadores ficam em um cadastro visual com cartões, busca, foto, apelido e cor.
- Ao criar um campeonato, você apenas seleciona os jogadores da lista.
- Em equipes, o sistema sorteia ou permite distribuir cada jogador entre os times.
- Resultados de equipes alimentam estatísticas individuais pela escalação.
- Dados são salvos no Supabase com autenticação por link mágico e políticas RLS.
- O importador abre o ZIP no navegador e envia os arquivos a uma função segura.
- A função autentica como GitHub App e cria um único commit atômico.
- Nenhum token do GitHub ou chave `service_role` fica exposto no HTML.

## 1. Criar o projeto no Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Execute `supabase/schema.sql`.
4. Em **Authentication → URL Configuration**, adicione a URL do Vercel em **Redirect URLs**.
5. Copie a Project URL, a publishable/anon key e a service role key.

A `service_role` é usada somente na função do servidor para validar o usuário. Nunca coloque essa chave no HTML.

## 2. Criar a GitHub App

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Dê permissão de repositório **Contents: Read and write**.
3. Não é necessário webhook para esta versão.
4. Instale a App somente no repositório do Arena Maker.
5. Gere uma chave privada `.pem`.
6. Anote o App ID e o Installation ID.

O importador bloqueia `.env`, `.git`, `node_modules` e `.github/workflows` por segurança.

## 3. Publicar no GitHub e Vercel

1. Envie todo o conteúdo desta pasta para um repositório novo.
2. Conecte o repositório ao Vercel.
3. Cadastre no Vercel as variáveis mostradas em `.env.example`.
4. Faça um novo deploy.

Após isso, qualquer commit no GitHub aciona automaticamente um novo deploy no Vercel.

## 4. Usar o importador de ZIP

1. Entre no Arena Maker usando o e-mail permitido.
2. Abra **Publicar ZIP**.
3. Arraste o ZIP.
4. Escolha se deseja apenas atualizar os arquivos do ZIP ou espelhar o ZIP inteiro.
5. Clique em **Fazer commit no GitHub**.

Limite atual: até 400 arquivos e 3 MB após extração. Esse limite mantém o envio abaixo do limite de corpo das funções do Vercel. Imagens grandes devem ficar no Supabase Storage, Cloudinary ou Vercel Blob, e não dentro do ZIP.

## Modo local

Sem Supabase configurado, o botão **Continuar em modo local** mantém jogadores e campeonatos no `localStorage`. O importador do GitHub exige login e configuração do servidor.
