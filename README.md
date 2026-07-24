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

## V11 — Correções da Central de Jogos
- Central ocupa 100% da tela sem rolagem externa quebrada.
- Tabela ao vivo mostra J/V/E/D/SG/PTS e usa números normalizados.
- Ao salvar o último jogo da liga em formato misto, o mata-mata é criado automaticamente.
- Campeonatos antigos que terminaram a liga e ficaram travados são reparados ao abrir.
- A Central troca automaticamente para o mata-mata e seleciona o primeiro confronto eliminatório.
- O painel lateral permite alternar entre Liga e mapa completo do mata-mata.


## V11.5
- Chave da Central posiciona a fase atual sem cortar a fase anterior.
- Foto do campeão substitui o ícone no cabeçalho após o título.
- Estatísticas completas ficam abaixo da Central de Jogos no mesmo popup.
- Celebração do campeão reforçada para o último jogo da liga e a final do mata-mata.


## V11.5
- Cabeçalho usa a imagem do campeonato, não a foto do campeão.
- Central de Jogos sem campo de observações e com cartões de placar refinados.
- Estatísticas aparecem diretamente abaixo da Central, sem faixa intermediária.
- Fotos dos jogadores nas tabelas e no elenco estatístico.
- Cor tema configurável na criação e na edição do campeonato.
