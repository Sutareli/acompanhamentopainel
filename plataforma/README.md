# Gestão de atividades — Plataforma da equipe

Aplicação web multiusuário (React + TypeScript + Tailwind) com **Supabase** (banco Postgres, autenticação, Realtime, RLS) e hospedagem no **Cloudflare Pages** (plano gratuito). Fuso padrão: America/Fortaleza · datas DD/MM/AAAA · 24 h.

## Versão consolidada — o que este pacote contém

Tudo abaixo está **neste único pacote** (código + `supabase/001_schema.sql` completo para instalação nova + migrações 002–007 para quem já tem banco no ar):

1. Nome **Gestão de atividades** · perfis Diretor / Gerente / Analista Sr / Analista / Guardião · função de convite atualizada.
2. Botão **Limpar lista do dia** (desmarcar ou apagar) e aba **Histórico de atividades**.
3. **Sem cronômetro**; usuários novos começam **sem atividades** (o dia seguinte herda o último dia com tarefas).
4. Paleta roxa e nova tela de login.
5. **Backlog de Melhorias** com painel de status, visão detalhada, etapas, histórico e cálculo automático; resumo dos chamados da base.
6. **Pareto backlog** (análise dos chamados).
7. **Importar bases** (somente Analista Sr): chamados do backlog (alimenta Pareto e Backlog) e projetos.
8. Menu: itens de backlog sempre por último (`… Gestão da equipe · Importar bases · Backlog de Melhorias · Pareto backlog`).

| Migração | O que faz | Rodar se o banco já está no ar |
|---|---|---|
| 001 | instalação completa | **nunca** em banco existente |
| 002 | perfis novos, arquivo de atividades, limpar dia | uma vez (se ainda não rodou) |
| 003 | Backlog de Melhorias | uma vez (se ainda não rodou) |
| 004 | etapas, histórico e cálculo automático | uma vez (se ainda não rodou) |
| 005 | base de chamados (Pareto) | uma vez (se ainda não rodou) |
| 007 | responsável e fase nos chamados (detalhamento “Quem é responsável” do Pareto) | uma vez, **depois** de 006, e reimporte a base de chamados |
| 006 | Atividades futuras (por bloco) e Projetos macro/micro (“com quem está”) | uma vez (se ainda não rodou) |

**Atalho:** quem rodou só a 002 pode executar **`supabase/003_a_006_tudo_junto.sql`** (003 + 004 + 005 + 006 em um arquivo, uma única vez) em vez de rodar um por um.

## Perfis e permissões

| Perfil | Própria jornada | Ver jornadas de outros (somente leitura) | Visão consolidada | Gestão (equipe, convites, configurações globais, auditoria) | Microentregas |
|---|---|---|---|---|---|
| Diretor | editar | sim | sim | não | ver / criar / editar |
| Gerente | editar | sim | sim | não | ver / criar / editar |
| Analista Sr | editar | sim | sim | **sim** | ver / criar / editar |
| Analista | editar | não | não | não | ver / criar / editar |
| Guardião | editar | não | não | não | ver / criar / editar |

- As regras são aplicadas **no banco (RLS)**, não apenas na tela. Perfis com visão total só têm `SELECT` nas jornadas alheias; `INSERT/UPDATE/DELETE` só no que é do próprio usuário.
- Microentregas: todos os usuários ativos podem ver, criar e editar (regra original mantida). Não existe `DELETE`; histórico e auditoria são gravados por triggers. **Decisão sua:** para restringir, ajuste as policies `md_ins`/`md_upd` no SQL.

### Status das microentregas
Calculado a partir da distribuição numérica (a iniciar `a`, em andamento `e`, concluídas `c`, canceladas `x`; a soma nunca passa do total `q`):
- **Cancelado**: todas as unidades canceladas.
- **Concluído**: todas as unidades concluídas.
- **Concluído c/ cancelamentos**: nada a iniciar nem em andamento, com ao menos uma concluída e uma cancelada.
- **A iniciar**: nada em andamento nem concluído.
- **Em andamento**: qualquer outra situação.
- Atrasada: prazo vencido com unidades ainda abertas. % de conclusão = concluídas ÷ (total − canceladas).

---

## Atividades futuras (Painel)

Cada bloco do Painel tem o quadro **📅 Atividades futuras**: escreva a atividade e escolha uma data (a partir de amanhã). Ela fica guardada e **continua visível no bloco** (com a data / “amanhã”) mesmo depois de **Limpar lista do dia**. Quando a data chega, ao abrir o Painel ela entra **uma única vez** na lista do bloco, no fim, como uma tarefa normal (se a data passou com o sistema fechado, entra no próximo acesso). Depois de incorporada, limpar o dia a remove como qualquer tarefa, e ela **não é copiada** para o dia seguinte. Cada pessoa vê e altera só as suas; Diretor/Gerente/Analista Sr podem ler. A tabela é `atividades_futuras` (migração 006).

### Alterar para dia seguinte

No lugar da caixa de observações, cada bloco tem o botão **➡️ Alterar para dia seguinte**: abre a lista das tarefas **pendentes** do bloco, você marca as que quer e clica em **Transferir para amanhã**. Elas saem da lista de hoje (não pesam na execução do dia) e ficam no quadro de atividades futuras do mesmo bloco como “amanhã”, entrando sozinhas na lista de amanhã. Não exige migração nova (usa a tabela da 006). Observações já gravadas antes continuam no banco e aparecem como “Observação anterior” (somente leitura).

## Projetos (antes “Microentregas”)

O menu **Microentregas** agora se chama **Projetos** (a tabela no banco continua `microdeliveries`). No cadastro há o seletor **MacroProjeto / MicroProjeto**; MacroProjeto tem ainda **Com quem está agora**. A lista tem filtro Todos · MacroProjetos · MicroProjetos. Projetos já existentes viram MicroProjeto automaticamente. Em **Gestão da equipe** há a alternância **Consolidado · MacroProjetos · MicroProjetos**: consolidado traz o comparativo macro × micro e as contagens por pessoa; MacroProjetos traz o quadro (projeto, responsável, com quem está, status, progresso, target) e “com quem estão os projetos em aberto”; MicroProjetos mantém os gráficos anteriores.

## Backlog de Melhorias (atividades, etapas e histórico)

Menu **Backlog de Melhorias**, visível a todos os perfis.

- **Tela principal:** painel **Status das Atividades** (rosca com total no centro, tabela Atrasado / Novo Prazo / Em andamento / A Iniciar / Concluído com % e quantidade, e **Análise de Desempenho**: Desempenho, % Planejado, % Realizado), lista das últimas mudanças de status e a tabela de atividades com filtros. Clicar num status do painel filtra a tabela.
- **Visão detalhada (clique na atividade):** painel **Status das Etapas**, descrição/objetivo/AS IS–TO BE, tabela de etapas (COMO? / responsável / início / término / novo prazo / prazo realizado / % concluído / % planejado / status / observações) e **Histórico de alterações** (quem mudou, quando, de→para; filtros por tipo e por etapa).
- **Cálculo automático:** quando a atividade tem etapas, o status e o % dela são calculados pelas etapas (todas concluídas → Concluído; alguma Atrasada → Atrasado; alguma Novo Prazo → Novo Prazo; alguma em andamento/concluída → Em andamento; senão A Iniciar; % = média). Nesse caso o status/% da atividade ficam bloqueados para edição manual (o banco também impede).
- **Planejado** = parte do prazo (início → novo prazo ou término) já decorrida hoje. **Desempenho** = % realizado ÷ % planejado (ex.: 0,60). O status é informado manualmente; o selo "prazo vencido" é só um aviso calculado pela data.

| Ação | Quem pode (garantido pelo RLS) |
|---|---|
| Ver atividades, etapas e histórico | todos os usuários ativos |
| Cadastrar atividade | todos os usuários ativos |
| Editar atividade / criar, editar e excluir etapas | quem cadastrou a atividade, e Diretor, Gerente e Analista Sr |
| Excluir atividade | somente Analista Sr |
| Histórico | gravado só pelo banco (ninguém edita) |

Regras: `Concluído` exige 100%; término não pode ser anterior ao início; novo prazo ≥ término; prioridade 1 = mais alta. O histórico **só registra a partir da execução da migração 004** (o que aconteceu antes não existe).

**Para quem já tem o banco no ar:** no SQL Editor rode, nesta ordem, `supabase/003_backlog_melhorias.sql` (se ainda não rodou) e depois `supabase/004_backlog_etapas_historico.sql`; em seguida faça o push desta versão. Instalação nova: só o `001`, que já inclui tudo. A função de convite não muda.

## Pareto backlog (análise dos chamados)

Menu **Pareto backlog** (os itens de backlog ficam sempre por último no menu), com a visão da planilha "Análise de backlog": filtros de **mês** e **tipo**; KPIs (total de chamados, no prazo e %, tipos, subcategorias) com comparação ao mês anterior; **Pareto por tipo** e **por subcategoria** (barras + % acumulado + linha de 80%); chamados por dia; rosquinhas de categoria e de tipo; lista dos chamados (clique numa barra de subcategoria para listar só os dela) e exportação CSV.

- **Quem vê:** todos os usuários ativos. **Quem importa:** somente o Analista Sr, na janela **Importar bases** (ver abaixo). A mesma base alimenta o Pareto e o card "Chamados da base do backlog" dentro do Backlog de Melhorias.
- **Regras iguais às da planilha:** o mês e o dia vêm de MÊS_REF/DIA/ANO_REF; "no prazo" = `TRATADO DENTRO DO PRAZO?` = "Dentro do prazo"; tipos que só mudam de maiúsculas/minúsculas (CONFIGURAÇÃO × Configuração) são somados; chamados sem subcategoria não entram no Pareto de subcategoria (a página avisa quantos são).
- **Filtro de tipo:** vale para tudo, exceto o Pareto de tipo (que é onde se escolhe). Na planilha o tipo só afetava a subcategoria; aqui também afeta KPIs e rosquinhas.

**Para quem já tem o banco no ar:** rode no SQL Editor `supabase/005_pareto_backlog_chamados.sql` (depois da 003 e 004), faça o push da versão e importe o CSV. Instalação nova: só o `001`.

---

### Quem é responsável pelos chamados (Pareto backlog)

Cartão com Almawave / Almaviva / Outros (empresa responsável). **Os números acompanham os filtros do Pareto** (mês, tipo e subcategoria selecionada): total de chamados e **abertos** (A iniciar + Em andamento + Suspenso; Concluído, Cancelado e Improcedente ficam fora). Clique no cartão (ou em “Ver detalhamento”) para abrir a janela, com abas Abertos · Todos do filtro, filtro por empresa, indicadores (chamados, abertos, % no prazo, idade média e mais antigo) e gráficos correlacionados: **Categoria × empresa**, **Responsável ROCCO × status**, **Pareto de subcategoria**, **idade dos abertos** e **fase**. Os gráficos se filtram entre si (clique em uma categoria, pessoa ou subcategoria) e a lista de chamados abaixo acompanha, com exportação CSV. Requer a migração 007 e reimportar a base (o CSV `modelos/chamados_backlog_import.csv` já vem com as colunas novas). A empresa vem da coluna “Empresa Responsável” da planilha; não é recalculada. **Se aparecer o aviso “base não traz as colunas de responsável”:** quase sempre a migração 007 não foi executada (sem ela o banco descarta os campos em silêncio). A tela de importação agora confere isso ao terminar e mostra a mensagem certa; a pré-visualização do arquivo informa quantos chamados têm empresa e responsável ROCCO.

## Importar bases (somente Analista Sr)

Menu **Importar bases** — aparece só para o Analista Sr (e a trava real está no banco). Duas cargas, ambas por CSV (Excel: *Salvar como → CSV UTF-8*; separador `;` ou `,`; a codificação "ANSI" também é aceita):

1. **Base de chamados do backlog** — aba `base` da planilha de análise. **Substitui toda a base** (operação única no banco: se der erro, a base atual é mantida). Cabeçalhos lidos: ID, DATA IDENTIFICAÇÃO, CATEGORIA, SUBCATEGORIA, TIPO, ITEM - SINTOMA, SISTEMA OFENSOR, CLIENTE, SITE, STATUS, TRATADO DENTRO DO PRAZO?, MÊS_REF, DIA, ANO_REF e, para o detalhamento de responsáveis, RESPONSÁVEL, EMPRESA RESPONSÁVEL (ou “Empresa Responsável”), RESPONSÁVEL ROCCO e FASE (as demais colunas são ignoradas). O arquivo `modelos/chamados_backlog_import.csv` já vem pronto com os dados da sua planilha (e `modelos/modelo-projetos.csv` é o modelo de projetos).
2. **Projetos (macro e micro)** — **adiciona** em lote, sem apagar as existentes. Use o botão "Baixar modelo CSV". Colunas: DEMANDA, RESPONSÁVEL (e-mail ou nome exato de usuário ativo), CRITICIDADE (alta/média/baixa), DATA TARGET (dd/mm/aaaa), QUANTIDADE, A INICIAR, EM ANDAMENTO, CONCLUÍDO, CANCELADO, RESUMO, OBSERVAÇÕES, TIPO (`macro` ou `micro`; vazio = micro) e COM QUEM ESTÁ (só para macro; opcional). Sem distribuição, tudo entra como "a iniciar". A soma dos status deve igualar a quantidade. Se **qualquer** linha tiver erro, nada é importado e a tela lista as linhas com problema. Linhas iguais às já cadastradas (mesma demanda + responsável + data target) são puladas, então reimportar o mesmo arquivo não duplica. O histórico de criação é gravado como no cadastro manual.

## Atualizando um banco que JÁ está no ar (versão anterior → esta)

Passo 2 abaixo é o da versão que renomeou os perfis; **se o seu banco já tem a 002, pule para a tabela da seção "Versão consolidada" e rode o que falta (003 a 006, ou o atalho `003_a_006_tudo_junto.sql`)** (tabela da seção "Versão consolidada"). Faça nesta ordem:

1. **Backup** (veja "Backup e recuperação" abaixo) — recomendado antes de mexer no banco.
2. **Supabase → SQL Editor**: cole e execute **`supabase/002_migracao_perfis_e_historico.sql`** (uma única vez). Ele converte `chefe_do_chefe → diretor`, `chefe → gerente`, `gestor → analista_sr`, atualiza as funções do RLS e cria o arquivo de atividades. **Não** reexecute o `001`.
3. **Publique a função de convite de novo** (ela passou a validar os novos perfis; sem isso, convidar usuários falha):
   `supabase functions deploy invite-user`
4. **GitHub**: faça commit/push desta versão. O Cloudflare Pages faz o deploy sozinho.
5. Entre na plataforma e confira: o seu usuário deve aparecer como **Analista Sr** e a tela "Gestão da equipe" continua disponível.

⚠️ Entre os passos 2 e 4, a versão antiga do site (que ainda procura "gestor") fica sem as telas de equipe por alguns minutos. Execute-os em sequência.
Instalação nova: ignore esta seção e use só o `001`.

---

## Implantação — passo a passo (nesta ordem)

### 1. Criar o projeto no Supabase
1. Em supabase.com crie um projeto (plano Free). Guarde a senha do banco.
2. **Authentication → Providers → Email**: mantenha e-mail/senha; **desative "Allow new users to sign up"** (acesso somente por convite).

### 2. Executar o SQL
**SQL Editor** → cole e execute `supabase/001_schema.sql` inteiro (instalação nova; já inclui tudo da migração 002) (tabelas, triggers, funções, RLS, views, Realtime).

### 3. Variáveis de ambiente (local)
Copie `.env.example` para `.env` e preencha com **Project Settings → API**:
```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=chave "anon / public"
```
**Nunca** use a `service_role` no front-end. Ela só existe dentro da Edge Function (servidor do Supabase). Teste local: `npm install && npm run dev`.

### 4. Criar o repositório no GitHub
```
git init && git add . && git commit -m "Plataforma Jornada"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git
git push -u origin main
```
O `.gitignore` já exclui `.env`. Repositório privado é recomendado.

### 5. Publicar no Cloudflare Pages (gratuito)
1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → escolha o repositório.
2. Configuração de build:
   - Framework preset: **React (Vite)**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Versão do Node: lida do arquivo `.node-version` (22). Se necessário, defina `NODE_VERSION=22` em variáveis.
3. **Environment variables** (Production **e** Preview): `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. São lidas **na hora do build**: se mudar, faça novo deploy.
4. **Save and Deploy**. Você receberá `https://SEU-APP.pages.dev` (HTTPS automático).
5. Domínio próprio (opcional): projeto → **Custom domains → Set up a domain**; o certificado HTTPS é emitido automaticamente.

Observações Cloudflare:
- **Rotas/SPA**: o app navega por estado (sem router) e o Pages serve `index.html` como fallback automaticamente (não há `404.html`); por isso não é necessário `_redirects`.
- **Cabeçalhos de segurança** (CSP etc.): `public/_headers`. A CSP permite apenas o próprio site e `*.supabase.co` (HTTP e WebSocket). Se algo for bloqueado, veja o console do navegador e ajuste `connect-src`.
- **Workers não são necessários**: convites usam Edge Function do Supabase (plano gratuito).

### 6. Autenticação e URLs de redirecionamento
No Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://SEU-APP.pages.dev` (ou seu domínio próprio).
- **Redirect URLs**: inclua o mesmo endereço (e o domínio próprio, se houver). Previews do Cloudflare (`https://*.SEU-APP.pages.dev`) só entram se você quiser testá-los.
Isso garante que convites e recuperação de senha voltem para o site correto.

### 7. Publicar a função de convite
Com a CLI do Supabase (`supabase login`, `supabase link --project-ref SEU-REF`):
```
supabase functions deploy invite-user
supabase secrets set SITE_URL=https://SEU-APP.pages.dev
supabase secrets set ALLOWED_ORIGINS=https://SEU-APP.pages.dev,https://seu-dominio.com.br
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já são fornecidos pelo Supabase à função.) Só Analistas Sr ativos conseguem convidar.

### 8. Criar usuários e definir perfis
1. **Primeiro Analista Sr** (você): em Authentication → Users → **Add user** (ou Invite) com seu e-mail; depois, no SQL Editor:
   ```sql
   update public.profiles set perfil = 'analista_sr' where email = 'seu@email.com';
   ```
2. Entre na plataforma; em **Gestão da equipe → Usuários** convide os demais escolhendo o perfil (Diretor, Gerente, Analista Sr, Analista, Guardião).
3. Cada convidado define a senha pelo link do e-mail. Recuperação de senha: "Esqueci minha senha" na tela de login.

> **Primeiro acesso de cada pessoa:** a jornada nasce com os 5 blocos e **nenhuma atividade** — cada um cria a própria lista. Nos dias seguintes, a lista é copiada do último dia que teve tarefas.

> **Logo na tela de login (opcional):** coloque um arquivo `logo.png` (fundo transparente, ~400 px de altura) na pasta `public/` e faça o deploy; ele aparece no topo do login no lugar do emblema padrão. Use apenas imagens que você tenha direito de usar.

### 9. Migrar dados do painel antigo
Cada pessoa, em **Configurações**, importa o JSON de backup do painel antigo. A importação **nunca sobrescreve** dados existentes.

---

## Backup e recuperação
- **Backup lógico** (CLI do Supabase; use a string de conexão em Project Settings → Database — se sua rede não tem IPv6, use o *Session pooler*):
  ```
  supabase db dump --db-url "postgresql://..." -f backup_schema.sql
  supabase db dump --db-url "postgresql://..." -f backup_dados.sql --data-only
  ```
  Guarde fora do Supabase e fora do repositório (contêm dados pessoais).
- **O plano Free não garante backups gerenciados**: agende o dump (por exemplo, semanal).
- **Restauração**: em um projeto novo, execute `supabase/001_schema.sql`, depois aplique `backup_dados.sql` (`psql "<conexão>" -f backup_dados.sql`). Usuários de `auth.users` não vêm no dump de `public`: recrie/convide as pessoas e reatribua os perfis (ou inclua o schema `auth` no dump, ciente das limitações).
- **Backup individual**: Configurações → exportar JSON.
- Exportações CSV em Histórico e Gestão da equipe.

---

## O que foi e o que NÃO foi testado

**Executado de fato (ambiente de desenvolvimento):**
- SQL completo carregado em um Postgres temporário; testes de RLS com os 5 perfis (visão de todas as jornadas × só a própria; escrita em dados de terceiros bloqueada; só Analista Sr altera perfis e lê auditoria; microentregas sem DELETE; triggers de histórico/auditoria; soma inválida bloqueada).
- Regra de status testada em 125 combinações, SQL × TypeScript idênticos.
- Checagem de tipos (`tsc`) do código-fonte contra *stubs* das bibliotecas; bundle com esbuild e renderização do menu por perfil (no servidor, com Supabase simulado).
- Varredura: nenhuma `service_role` em `src/`; somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; `.env` ignorado pelo Git.

- (Versão atual) Migração 002 aplicada sobre uma cópia do esquema anterior com usuários nos perfis antigos: perfis convertidos corretamente; e o `001` novo carregado do zero. Nos dois bancos: visão de todas as jornadas só para Diretor/Gerente/Analista Sr (Analista e Guardião veem apenas a própria), escrita em dado alheio bloqueada, só Analista Sr altera perfis, `dia_limpar` (desmarcar/apagar) arquiva as concluídas e não funciona no dia de outra pessoa, `v_atividades` respeita o RLS.
- (Versão atual) `tsc` contra stubs, bundle esbuild e prévia no Chromium com banco simulado: sem cronômetro, diálogo de confirmação, aba Histórico de atividades e menus por perfil.

- (Versão atual) Esquema: o `001` novo e a cadeia `001 antigo → 002 → 003 → 004 → 005` produzem catálogos **idênticos** (444 linhas de tabelas, colunas, funções, políticas, gatilhos e restrições comparadas). Função `chamados_substituir`: Analista comum barrado, escrita direta barrada pelo RLS, substituição atômica (falha mantém a base), Analista Sr importa.
- (Versão atual) Prévia no Chromium com banco simulado: Backlog (painel, detalhe, etapas, histórico), Pareto (números conferidos contra a planilha de origem: 133 chamados/109 no prazo em outubro), Importar bases (modelo CSV, arquivo com erros bloqueado, importação, reimportação sem duplicar, chamados via nova janela), menus por perfil e celular.
- O leitor de CSV (aspas, quebras de linha, `;`/`,`, datas dd/mm/aaaa e número de série do Excel) foi exercitado com a base real de 1.226 linhas.

- (Versão atual) Migração 006: cadeia `001 antigo → 002 → 003_a_006` e `001` novo produzem catálogos **idênticos** (472 linhas). Testado no Postgres: `futuras_incorporar` (incorpora vencidas e de hoje uma única vez, 2ª chamada devolve 0, data futura recusada), limpar dia não apaga futuras pendentes, RLS (não cria em nome de terceiro, outro usuário não apaga nem altera), MacroProjeto com “com quem”, “com quem” inativo e tipo inválido recusados, histórico das mudanças de tipo/com quem, `com_quem_nome` na visão.
- (Versão atual) Prévia no Chromium: quadro de atividades futuras por bloco (permanece após limpar; incorporação de vencida), Projetos (filtro, seletor de tipo, “com quem”), Gestão da equipe nas 3 visões, painel de status executivo, Pareto com “Tipo de chamado” em largura total. Sem erros de console.

- (Versão atual) Prévia no Chromium: “Alterar para dia seguinte” (seleção de 2 tarefas, bloco de 7 para 5 tarefas, aparecem como “amanhã” nas futuras do bloco).

- (Versão atual) Migração 007: `001` novo e `001 anterior → 007` com mesmas colunas e mesma função (`chamados_substituir`, grants idênticos); importação com os 4 campos novos gravada e lida. Prévia no Chromium com a base real: 19 abertos (18 Almawave, 1 Almaviva), janela de detalhamento, filtros por empresa e pessoa.

**NÃO executado (precisa de internet/credenciais — faça você):**
- `npm install`, `npm run typecheck` e `npm run build` reais (o ambiente de validação não tinha acesso ao npm). Rode-os antes do primeiro deploy; se `tsc` apontar algo, é ajuste pontual.
- Não há `package-lock.json`: o primeiro `npm install` o gera — faça commit dele.
- Teste contra Supabase real (Auth, convites, e-mails, Realtime, Edge Function) e deploy real no Cloudflare Pages.
- Teste no navegador, incluindo se a CSP em `_headers` bloqueia algo.

## Passos manuais que ficam com você
Criar projetos Supabase/GitHub/Cloudflare; executar o SQL; definir variáveis; configurar Site URL e Redirect URLs; publicar a função e seus secrets; promover o primeiro Analista Sr; convidar a equipe; agendar backups; rodar `npm install/typecheck/build` e fazer o primeiro teste ponta a ponta.
