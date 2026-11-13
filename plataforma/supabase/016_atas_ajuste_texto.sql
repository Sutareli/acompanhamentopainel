-- 016 · Ajuste das Atas importantes para o formato "texto colado" (sem arquivo). SEGURO PARA RODAR EM QUALQUER CASO:
--   • se você rodou a 015 já no formato de texto, não muda nada;
--   • se rodou uma versão antiga da 015 (com upload de arquivo), converte a tabela e remove o que era do Storage.
do $$
begin
  alter table public.atas add column if not exists texto text;
  update public.atas set texto = coalesce(nullif(trim(resumo), ''), '(sem texto)') where texto is null or trim(texto) = '';
  update public.atas set resumo = left(resumo, 1000) where length(resumo) > 1000;
  alter table public.atas alter column texto set not null;
  alter table public.atas drop constraint if exists atas_texto_check;
  alter table public.atas add constraint atas_texto_check check (length(trim(texto)) > 0 and length(texto) <= 50000);
  alter table public.atas drop constraint if exists atas_resumo_check;
  alter table public.atas add constraint atas_resumo_check check (resumo is null or length(resumo) <= 1000);
  alter table public.atas drop column if exists arquivo_path, drop column if exists arquivo_nome, drop column if exists arquivo_tamanho;
  if to_regclass('storage.objects') is not null then
    drop policy if exists atas_arq_sel on storage.objects; drop policy if exists atas_arq_ins on storage.objects;
    drop policy if exists atas_arq_upd on storage.objects; drop policy if exists atas_arq_del on storage.objects;
    delete from storage.buckets b where b.id = 'atas' and not exists (select 1 from storage.objects o where o.bucket_id = 'atas');
  end if;
end $$;
