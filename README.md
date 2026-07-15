# Arena Maker V4

Versão reconstruída com foco total nos campeonatos.

- A tela inicial mostra apenas campeonatos.
- Os participantes são cadastrados dentro de cada campeonato.
- Formatos: Liga, Mata-mata e Liga + Mata-mata.
- No formato misto, qualquer quantidade de classificados pode ser definida; folgas são geradas quando necessário.
- Equipes mantêm estatísticas individuais por escalação.
- Resultados, escolhas usadas, MVP e observações são registrados por partida.
- Dados salvos na tabela `tournaments` do Supabase.
- Publicador de ZIP para GitHub mantido.

Não execute novamente o SQL se sua tabela `tournaments` já funciona. O arquivo `supabase/schema.sql` é apenas para instalação ou reparo.
