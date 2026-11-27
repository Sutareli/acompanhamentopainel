"""Gera o modelo (layout + fórmulas) da planilha Rocco_CSAT_Dashboard para o módulo C-SAT Rocco.
Uso: unzip arquivo.xlsx -d pasta_zip && python3 gerar_modelo.py arquivo.xlsx pasta_zip ../../plataforma/src/csat/modelo.json
(precisa de openpyxl e lxml). Rode de novo sempre que a planilha mudar de layout ou de fórmulas."""
import sys, json, re, subprocess, os
AQUI = os.path.dirname(os.path.abspath(__file__))
import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string
xlsx, zdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
wb = openpyxl.load_workbook(xlsx)
wbv = openpyxl.load_workbook(xlsx, data_only=True)
# Conteúdo que vem do banco (carregado pela planilha completa em Importar bases), não do modelo publicado:
# o repositório e os arquivos do site são públicos, então cadastros e exemplos reais ficam fora do modelo.
SEM_VALOR = {'Regras': [(6,2,21,5),(6,10,131,11),(6,13,37,13),(25,3,30,3)], 'Cadastros': [(5,1,58,3),(5,5,1089,8),(5,10,24,11)]}
def sem_valor(ws, r, c): return any(r1<=r<=r2 and c1<=c<=c2 for (r1,c1,r2,c2) in SEM_VALOR.get(ws, []))
DATA_SHEETS = {'Base de Dados': 4, 'Quadro Colaboradores': 1, 'Quadro STAFF': 1}   # só cabeçalho (até a linha indicada); os dados vêm do banco
THEME = {0:'FFFFFF',1:'000000',2:'E7E6E6',3:'44546A',4:'4472C4',5:'ED7D31',6:'A5A5A5',7:'FFC000',8:'5B9BD5',9:'70AD47'}
def tint(hexc, t):
    r,g,b = int(hexc[0:2],16),int(hexc[2:4],16),int(hexc[4:6],16)
    f = (lambda x: x*(1+t)) if t<0 else (lambda x: x+(255-x)*t)
    return '%02X%02X%02X'%tuple(max(0,min(255,round(f(v)))) for v in (r,g,b))
def col(c):
    if c is None: return None
    if c.type=='rgb' and isinstance(c.rgb,str):
        return c.rgb[-6:] if c.rgb not in ('00000000',) else None
    if c.type=='theme' and c.theme is not None:
        base = THEME.get(c.theme,'000000'); return tint(base, c.tint or 0) if c.tint else base
    if c.type=='indexed' and c.indexed==64: return None
    return None
styles=[{}]; sidx={'{}':0}
def style_of(c):
    f=c.font; fi=c.fill; b=c.border; a=c.alignment
    s={}
    if f:
        if f.name and f.name!='Calibri': s['fn']=f.name
        if f.sz and float(f.sz)!=11: s['fs']=float(f.sz)
        if f.b: s['b']=1
        if f.i: s['i']=1
        if f.u: s['u']=1
        fc=col(f.color)
        if fc and fc!='000000': s['fc']=fc
    if fi is not None and fi.fill_type=='solid':
        bg=col(fi.fgColor)
        if bg: s['bg']=bg
    for side in ('left','right','top','bottom'):
        sd=getattr(b,side)
        if sd is not None and sd.style:
            s['b'+side[0]]=[sd.style, col(sd.color) or '000000']
    if a:
        if a.horizontal: s['h']=a.horizontal
        if a.vertical: s['v']=a.vertical
        if a.wrap_text: s['w']=1
        if a.indent: s['ind']=a.indent
        if a.text_rotation: s['rot']=a.text_rotation
    if c.number_format and c.number_format!='General': s['nf']=c.number_format
    key=json.dumps(s,sort_keys=True)
    if key not in sidx: sidx[key]=len(styles); styles.append(s)
    return sidx[key]
def colpx(w): return int(w*7+0.5) if w is not None else 64
def norm_formula(v):
    return v if isinstance(v,str) and v.startswith('=') else None
def jsonable(v):
    import datetime
    if isinstance(v,datetime.datetime):
        # serial do Excel
        d=(v-datetime.datetime(1899,12,30)); return round(d.days + d.seconds/86400,10)
    if isinstance(v,datetime.date): return (v-datetime.date(1899,12,30)).days
    if isinstance(v,datetime.time): return round((v.hour*3600+v.minute*60+v.second)/86400,10)
    return v
# desenhos
import importlib.util
def drawing_for(sheet_index):
    import os
    rel=f'{zdir}/xl/worksheets/_rels/sheet{sheet_index}.xml.rels'
    if not os.path.exists(rel): return []
    t=open(rel,encoding='utf8').read(); m=re.search(r'Target="\.\./drawings/(drawing\d+)\.xml"',t)
    if not m: return []
    dn=m.group(1)
    res=subprocess.run(['python3','-I',f'{AQUI}/extract_drawing.py',f'{zdir}/xl/drawings/{dn}.xml',f'{zdir}/xl/drawings/_rels/{dn}.xml.rels'],capture_output=True,text=True,check=True)
    items=json.loads(res.stdout)
    for it in items:
        if it.get('chart'):
            cn=it['chart'].split('/')[-1]
            r2=subprocess.run(['python3','-I',f'{AQUI}/extract_chart.py',f'{zdir}/xl/charts/{cn}'],capture_output=True,text=True,check=True)
            it['chartSpec']=json.loads(r2.stdout)
            for p in it['chartSpec']['plots']:
                for s in p['series']:
                    for k in ('tx','cat','val'):
                        if s.get(k) and 'v' in s[k] and k!='tx': s[k].pop('v',None)   # valores vêm do motor
        if it.get('image'): it['image']=it['image'].split('/')[-1]
        if it.get('textlink'):   # texto vem da célula ligada: não guarda o valor salvo no arquivo
            for p in it.get('paras',[]):
                for r in p['runs']:
                    if 't' in r: r['t']=''
    return items
model={'sheets':{}, 'styles':styles, 'tables':{}, 'names':{}, 'order':[]}
for n,dn in wb.defined_names.items(): model['names'][n]=dn.attr_text
for i,ws in enumerate(wb.worksheets, start=1):
    wv=wbv[ws.title]
    sh={'state':ws.sheet_state,'zoom':ws.sheet_view.zoomScale,'freeze':ws.freeze_panes,'grid':ws.sheet_view.showGridLines is not False}
    # larguras
    maxc=ws.max_column; widths={}
    for k,d in ws.column_dimensions.items():
        lo=d.min or column_index_from_string(k); hi=d.max or lo
        for cc in range(lo,min(hi,maxc+5)+1): widths[cc]=(colpx(d.width) if d.width else 64, bool(d.hidden))
    sh['cols']=[widths.get(cc,(64,False))[0] for cc in range(1,maxc+1)]
    sh['hiddenCols']=[cc for cc in range(1,maxc+1) if widths.get(cc,(64,False))[1]]
    sh['defRow']=round((ws.sheet_format.defaultRowHeight or 15)*4/3,2)
    sh['rows']={}; sh['hiddenRows']=[]
    for r,d in ws.row_dimensions.items():
        if d.height is not None: sh['rows'][r]=round(d.height*4/3,2)
        if d.hidden: sh['hiddenRows'].append(r)
    lim=DATA_SHEETS.get(ws.title)
    sh['maxRow']=ws.max_row if lim is None else lim; sh['maxCol']=maxc
    sh['merges']=[[m.min_row,m.min_col,m.max_row,m.max_col] for m in ws.merged_cells.ranges if lim is None or m.min_row<=lim]
    cells={}
    for row in ws.iter_rows(max_row=sh['maxRow']):
        for c in row:
            if c.value is None and not c.has_style: continue
            st=style_of(c) if c.has_style else 0
            f=norm_formula(c.value)
            v=None if f else jsonable(c.value)
            if not f and sem_valor(ws.title, c.row, c.column): v=None
            if f is None and v is None and st==0: continue
            e=[st]
            if f: e+= [None,f]
            elif v is not None: e+= [v]
            cells[f'{c.row},{c.column}']=e
    sh['cells']=cells
    if lim is not None:
        tpl={}
        for c in ws[lim+1]:
            if c.has_style: tpl[c.column]=style_of(c)
        sh['rowTemplate']=tpl
        sh['dataRowHeight']=round((ws.row_dimensions[lim+1].height or ws.sheet_format.defaultRowHeight or 15)*4/3,2)
    sh['dv']=[{'sqref':str(dv.sqref),'type':dv.type,'f1':dv.formula1} for dv in ws.data_validations.dataValidation]
    cf=[]
    for rng,rules in ws.conditional_formatting._cf_rules.items():
        for r in rules:
            d={'sqref':str(rng.sqref),'type':r.type,'op':r.operator,'f':r.formula,'pri':r.priority}
            if r.dxf:
                if r.dxf.fill and r.dxf.fill.fgColor is not None and r.dxf.fill.fgColor.rgb: d['bg']=str(r.dxf.fill.fgColor.rgb)[-6:]
                if r.dxf.font:
                    if r.dxf.font.color is not None and r.dxf.font.color.rgb: d['fc']=str(r.dxf.font.color.rgb)[-6:]
                    if r.dxf.font.b: d['b']=1
            if r.colorScale: d['cs']={'cfvo':[[c.type,c.val] for c in r.colorScale.cfvo],'colors':[str(c.rgb)[-6:] for c in r.colorScale.color]}
            if r.dataBar: d['db']={'cfvo':[[c.type,c.val] for c in r.dataBar.cfvo],'color':str(r.dataBar.color.rgb)[-6:]}
            cf.append(d)
    sh['cf']=cf
    sh['drawings']=drawing_for(i)
    for tn in list(ws.tables.keys()):
        t=ws.tables[tn]
        ref=t.ref; m=re.match(r'([A-Z]+)(\d+):([A-Z]+)(\d+)',ref)
        c0=column_index_from_string(m.group(1)); r0=int(m.group(2)); c1=column_index_from_string(m.group(3)); r1=int(m.group(4))
        names=[tc.name for tc in t.tableColumns]
        calc={}
        if lim is not None:
            for j,nm in enumerate(names):
                f=ws.cell(r0+1,c0+j).value
                if norm_formula(f): calc[nm]=f
        model['tables'][tn]={'sheet':ws.title,'c0':c0,'r0':r0,'c1':c1,'r1':r1,'cols':names,'calc':calc,'data':lim is not None}
    model['sheets'][ws.title]=sh; model['order'].append(ws.title)
json.dump(model, open(out,'w'), ensure_ascii=False, separators=(',',':'))
print('ok', len(styles), 'styles')
