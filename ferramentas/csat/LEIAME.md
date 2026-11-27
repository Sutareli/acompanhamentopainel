# Ferramentas do módulo C-SAT Rocco

O módulo **C-SAT Rocco** da plataforma é a planilha `Rocco_CSAT_Dashboard.xlsx` dentro do painel: as abas, o layout (células,
formas, gráficos, cores) e **as próprias fórmulas** da planilha, executadas no navegador pelo motor em `plataforma/src/csat/motor`.

- `gerar_modelo.py` lê a planilha e grava `plataforma/src/csat/modelo.json` (layout + fórmulas; sem os dados).
- `extract_drawing.py` / `extract_chart.py` são usados por ele para as formas e os gráficos.

Quando a planilha mudar (novas fórmulas, novo layout), gere o modelo de novo:

```bash
mkdir /tmp/z && unzip -q Rocco_CSAT_Dashboard.xlsx -d /tmp/z
python3 gerar_modelo.py Rocco_CSAT_Dashboard.xlsx /tmp/z ../../plataforma/src/csat/modelo.json
```

Os dados (aba Base de Dados, quadros) ficam no Supabase e são carregados em **Importar bases → C-SAT Rocco**.
