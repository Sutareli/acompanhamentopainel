# E-mail de redefinição de senha e de convite (Supabase)

O app aceita dois formatos de link. O **modelo recomendado** abaixo evita que antivírus e leitores de e-mail (o Gmail abre links para checar) gastem o link antes da pessoa clicar. Nos logs do Supabase aparece exatamente isso: acessos ao `/verify` vindos de IP do Google.

Onde configurar: Supabase > **Authentication > Emails > Templates**.

## Reset Password (Redefinir senha)

Assunto: `Redefinir sua senha - Gestão de atividades`

```html
<h2>Redefinir sua senha</h2>
<p>Recebemos um pedido para criar uma nova senha de acesso à plataforma Gestão de atividades.</p>
<p><a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery">Criar nova senha</a></p>
<p>O link vale por 1 hora e só pode ser usado uma vez. Se você pediu mais de um e-mail, use sempre o mais recente.</p>
<p>Se você não fez este pedido, ignore este e-mail.</p>
```

## Invite user (Convite)

Assunto: `Seu acesso à plataforma Gestão de atividades`

```html
<h2>Você foi convidado</h2>
<p>Ative seu acesso à plataforma Gestão de atividades e crie sua senha.</p>
<p><a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=invite">Ativar acesso</a></p>
<p>O link vale por 1 hora e só pode ser usado uma vez.</p>
```

Observações:
- `Site URL` (Authentication > URL Configuration) precisa ser o endereço do site publicado.
- O tempo de validade do link fica em Authentication > Sign In / Providers > Email > *Email OTP expiration* (padrão 3600 s).
- Com o modelo antigo (link padrão do Supabase) tudo continua funcionando; a diferença é só a proteção contra o link ser gasto antes do clique.
