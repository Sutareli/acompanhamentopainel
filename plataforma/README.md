# Gestão de atividades — Plataforma da equipe

Aplicação web multiusuário (React + TypeScript + Tailwind) com **Supabase** (banco Postgres, autenticação, Realtime, RLS) e hospedagem no **Cloudflare Pages** (plano gratuito). Fuso padrão: America/Fortaleza · datas DD/MM/AAAA · 24 h.

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

## Atualizando um banco que JÁ está no ar (versão anterior → esta)

Esta versão renomeia os perfis, remove o cronômetro, adiciona o Histórico de atividades e o botão "Limpar lista do dia". Faça nesta ordem:

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

**NÃO executado (precisa de internet/credenciais — faça você):**
- `npm install`, `npm run typecheck` e `npm run build` reais (o ambiente de validação não tinha acesso ao npm). Rode-os antes do primeiro deploy; se `tsc` apontar algo, é ajuste pontual.
- Não há `package-lock.json`: o primeiro `npm install` o gera — faça commit dele.
- Teste contra Supabase real (Auth, convites, e-mails, Realtime, Edge Function) e deploy real no Cloudflare Pages.
- Teste no navegador, incluindo se a CSP em `_headers` bloqueia algo.

## Passos manuais que ficam com você
Criar projetos Supabase/GitHub/Cloudflare; executar o SQL; definir variáveis; configurar Site URL e Redirect URLs; publicar a função e seus secrets; promover o primeiro Analista Sr; convidar a equipe; agendar backups; rodar `npm install/typecheck/build` e fazer o primeiro teste ponta a ponta.
