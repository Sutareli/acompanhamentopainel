# Ambiente de teste — como mudar o sistema sem arriscar a produção

Hoje tudo vai direto para a `main` e para o Supabase de produção. Este guia monta um caminho seguro **sem custo extra**.

## 1. Testar o visual antes de publicar (Cloudflare Pages, grátis)
O Cloudflare Pages gera um **endereço de prévia para cada branch** que não seja a `main`.
1. Crie um branch: `git checkout -b teste` e envie (`git push -u origin teste`).
2. Em **Cloudflare → Pages → seu projeto → Deployments**, aparece o deploy de prévia com um endereço próprio (`teste.seu-app.pages.dev`).
3. Aprovou? Abra um *Pull Request* de `teste` para `main` e faça o merge: só então vai para produção.

> A prévia usa as mesmas variáveis de ambiente de produção (mesmo Supabase). Por isso, em prévia, **não teste importações nem exclusões**. Para isso use o item 2.

## 2. Banco de teste (separado da produção)
**Opção A, grátis:** criar um **segundo projeto** no Supabase (o plano Free permite 2 projetos ativos).
1. supabase.com → *New project* (nome `gestao-teste`).
2. SQL Editor → rode `supabase/001_schema.sql` (instalação nova, já inclui tudo até a 025).
3. Em **Cloudflare → Pages → Settings → Environment variables**, na aba **Preview**, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do projeto de teste. Os branches de prévia passam a usar o banco de teste; a `main` continua no de produção.
4. Crie usuários de teste lá (Authentication → Users) e ajuste o perfil em `profiles`.

**Opção B, pago:** *Supabase Branching* (recurso do plano Pro) cria um banco temporário por branch do GitHub.

## 3. Testes automáticos (já incluídos)
- `npm test` roda 22+ testes das regras (SLA com feriados, andamento por etapa, comparativo de chamados, metas).
- `tests/sql/025_testes.sql` testa as regras do banco (permissões por perfil, backup, desfazer carga, avisos). Rodam sozinhos no GitHub a cada envio (arquivo `.github/workflows/ci.yml`): se algum falhar, aparece um ❌ no commit.
- Para rodar o SQL na sua máquina, em um Postgres **de teste**: `psql -f tests/sql/_stubs_supabase.sql -f supabase/001_schema.sql -f tests/sql/025_testes.sql`.

## 4. Rotina recomendada para mudanças
1. Mudança em branch `teste` → conferir a prévia → ver se o ✅ do GitHub passou.
2. Mudança de banco (SQL): rodar primeiro no projeto de teste.
3. Merge na `main` → rodar o SQL em produção → conferir o número de versão no rodapé do menu (deve ser o do último commit).
