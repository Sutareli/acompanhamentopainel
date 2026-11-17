# Aviso semanal por e-mail — passo a passo

Toda **segunda-feira, às 08:00 (Fortaleza)** o sistema envia um e-mail com: melhorias e correções com **prazo vencido**, **SLA estourado**, itens **sem responsável** e atividades com **data target vencida**. Só vão títulos e números (sem dados pessoais).

O destinatário inicial é `jsilas@almavivadobrasil.com.br`. Para trocar ou pausar: menu **🛡️ Segurança → Aviso semanal por e-mail**.

> O sistema só envia depois dos passos abaixo. Sem eles, nada é enviado e a tela de Segurança mostra o motivo.

## 1. Banco de dados
Rode `supabase/025_feriados_metas_comentarios_backup_avisos.sql` (ou o `008_a_027_tudo_junto.sql`) no **SQL Editor**.

## 2. Conta no Resend (serviço de e-mail, plano gratuito)
1. Crie a conta em <https://resend.com>. **Use o mesmo e-mail que vai receber o aviso** (`jsilas@almavivadobrasil.com.br`): no plano gratuito, sem domínio próprio verificado, o Resend só entrega para o e-mail dono da conta.
2. **API Keys → Create API Key** (permissão *Sending access*). Copie a chave (começa com `re_`). Ela aparece uma vez só.
3. Se quiser enviar para **mais de um endereço** ou usar um remetente da empresa, verifique um domínio em **Domains** e cadastre o Secret `AVISO_REMETENTE` (passo 3).

## 3. Secrets no Supabase
**Edge Functions → Secrets → Add new secret**:

| Nome | Valor |
|---|---|
| `RESEND_API_KEY` | a chave do passo 2 |
| `SITE_URL` | endereço do sistema, ex.: `https://seu-app.pages.dev` |
| `AVISO_REMETENTE` | *(opcional)* ex.: `Gestão de atividades <avisos@seudominio.com.br>` |

**Nunca** coloque essas chaves no código, no GitHub ou em variáveis `VITE_`.

## 4. Publicar a função
**Edge Functions → Deploy a new function → Via Editor**, nome **`aviso-semanal`**, cole o conteúdo de `supabase/functions/aviso-semanal/index.ts`. Deixe **Verify JWT desligado** (a função se protege sozinha: só aceita o segredo do agendamento ou um Analista Sr logado).

## 5. Testar
No sistema: **🛡️ Segurança → Aviso semanal por e-mail → ✉ Enviar agora (teste)**. O e-mail chega em segundos (olhe o spam). A tela mostra “Último envio” e o resultado.

## 6. Agendar

## Problemas comuns
| Mensagem em “Último envio” | O que fazer |
|---|---|
| `RESEND_API_KEY não configurada` | Passo 3 |
| `FALHOU (403)` / `only send testing emails to your own email` | O destinatário não é o dono da conta Resend: use o mesmo e-mail da conta ou verifique um domínio |
| `FALHOU (401)` | Chave do Resend errada ou revogada: gere outra |
