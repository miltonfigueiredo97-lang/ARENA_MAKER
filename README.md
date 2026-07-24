# Arena Maker V10

Atualização centrada na experiência do campeonato.

## Novidades

- Edição do nome, capa e perfil do jogo após a criação.
- Edição do nome e da foto de todos os jogadores.
- Imagens salvas no Supabase Storage (`arena-media`).
- URLs das imagens persistidas no estado JSON do campeonato e capa também na coluna `cover_image_url`.
- Nova tela principal com confronto em destaque e classificação/chave ao lado.
- Aba Partidas removida do menu principal.
- Central de Jogos em tela cheia para navegar e preencher resultados.
- Reconfiguração do formato com aviso explícito de que os resultados serão apagados.
- Compatibilidade com Individual, Equipes Fixas e Equipes Rotativas.

## Atualização obrigatória do Supabase

Antes de enviar fotos, execute no SQL Editor:

`supabase/MIGRACAO_V10.sql`

O script:

1. adiciona `cover_image_url` sem apagar dados;
2. corrige o `mode` para aceitar `dynamic`;
3. cria o bucket público `arena-media` com limite de 5 MB;
4. cria as políticas de upload, leitura, atualização e exclusão.

## Publicação

Envie o ZIP pelo importador do Arena Maker sem marcar **Espelhar repositório**. A Vercel fará um novo deploy após o commit.

## Observação de acesso

O projeto continua sem login, conforme solicitado. Portanto, quem tiver acesso à URL do sistema também poderá alterar dados e enviar imagens. O `PUBLISH_SECRET` protege apenas a publicação de ZIP no GitHub.
