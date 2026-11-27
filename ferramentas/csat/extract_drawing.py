import sys, json, re
from lxml import etree
ns={'xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
E=9525
def px(v): return round(int(v)/E,2)
def color(el):
    if el is None: return None
    s=el.find('a:solidFill',ns)
    if s is None:
        if el.find('a:noFill',ns) is not None: return 'none'
        return None
    c=s.find('a:srgbClr',ns)
    if c is None: return None
    al=c.find('a:alpha',ns)
    return c.get('val')+(':%s'%(int(al.get('val'))/100000) if al is not None else '')
def shape(sp):
    d={}
    d['textlink']=sp.get('textlink') or ''
    d['name']=sp.find('.//xdr:cNvPr',ns).get('name')
    spPr=sp.find('xdr:spPr',ns)
    g=spPr.find('a:prstGeom',ns); d['geom']=g.get('prst') if g is not None else None
    adj=spPr.find('.//a:gd',ns); d['adj']=adj.get('fmla') if adj is not None else None
    d['fill']=color(spPr)
    ln=spPr.find('a:ln',ns)
    if ln is not None: d['line']=color(ln); d['lineW']=ln.get('w')
    sh=spPr.find('.//a:outerShdw',ns); d['shadow']=sh is not None
    xf=spPr.find('a:xfrm',ns)
    if xf is not None and xf.get('rot'): d['rot']=xf.get('rot')
    tb=sp.find('xdr:txBody',ns)
    if tb is not None:
        bp=tb.find('a:bodyPr',ns); d['body']={k:v for k,v in bp.attrib.items()}
        paras=[]
        for p in tb.findall('a:p',ns):
            pp=p.find('a:pPr',ns); algn=pp.get('algn') if pp is not None else None
            runs=[]
            for r in p:
                tag=etree.QName(r).localname
                if tag in('r','fld'):
                    rp=r.find('a:rPr',ns); t=r.find('a:t',ns)
                    rr={'t':t.text if t is not None else ''}
                    if rp is not None:
                        for k in('sz','b','i','u'):
                            if rp.get(k): rr[k]=rp.get(k)
                        cc=color(rp)
                        if cc: rr['c']=cc
                        lat=rp.find('a:latin',ns)
                        if lat is not None: rr['font']=lat.get('typeface')
                    runs.append(rr)
                elif tag=='br': runs.append({'br':1})
            ep=p.find('a:endParaRPr',ns)
            paras.append({'algn':algn,'runs':runs,'endsz':ep.get('sz') if ep is not None else None})
        d['paras']=paras
    return d
def main(path, rels):
    t=etree.parse(path).getroot(); out=[]
    relmap={}
    rx=etree.parse(rels).getroot()
    for r in rx: relmap[r.get('Id')]=r.get('Target')
    for anc in t:
        tag=etree.QName(anc).localname
        item={'anchor':tag}
        if tag=='absoluteAnchor':
            p=anc.find('xdr:pos',ns); e=anc.find('xdr:ext',ns)
            item.update(x=px(p.get('x')),y=px(p.get('y')),w=px(e.get('cx')),h=px(e.get('cy')))
        else:
            f=anc.find('xdr:from',ns)
            item['from']=[int(f.find('xdr:col',ns).text),px(f.find('xdr:colOff',ns).text),int(f.find('xdr:row',ns).text),px(f.find('xdr:rowOff',ns).text)]
            e=anc.find('xdr:ext',ns)
            if e is not None: item.update(w=px(e.get('cx')),h=px(e.get('cy')))
            to=anc.find('xdr:to',ns)
            if to is not None: item['to']=[int(to.find('xdr:col',ns).text),px(to.find('xdr:colOff',ns).text),int(to.find('xdr:row',ns).text),px(to.find('xdr:rowOff',ns).text)]
        el=[c for c in anc if etree.QName(c).localname in('sp','graphicFrame','pic','grpSp','cxnSp')]
        if not el: continue
        el=el[0]; k=etree.QName(el).localname; item['kind']=k
        if k=='sp': item.update(shape(el))
        elif k=='graphicFrame':
            ch=el.find('.//c:chart',ns); item['chart']=relmap.get(ch.get('{%s}id'%ns['r']))
        elif k=='pic':
            b=el.find('.//a:blip',ns); item['image']=relmap.get(b.get('{%s}embed'%ns['r']))
        else: item['other']=k
        out.append(item)
    print(json.dumps(out,ensure_ascii=False,indent=0))
main(sys.argv[1],sys.argv[2])
