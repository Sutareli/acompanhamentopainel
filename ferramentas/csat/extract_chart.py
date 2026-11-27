import sys,json
from lxml import etree
ns={'c':'http://schemas.openxmlformats.org/drawingml/2006/chart','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
def val(el,path,attr='val'):
    x=el.find(path,ns); return x.get(attr) if x is not None else None
def fill(sp):
    if sp is None: return None
    s=sp.find('a:solidFill/a:srgbClr',ns)
    if s is not None: return s.get('val')
    if sp.find('a:noFill',ns) is not None: return 'none'
    return None
def lnfill(sp):
    if sp is None: return None
    ln=sp.find('a:ln',ns)
    if ln is None: return None
    return {'c':fill(ln),'w':ln.get('w'),'dash':val(ln,'a:prstDash')}
def txpr(el):
    t=el.find('c:txPr',ns)
    if t is None: return None
    d=t.find('.//a:defRPr',ns)
    if d is None: return None
    return {'sz':d.get('sz'),'b':d.get('b'),'c':fill(d)}
def cache(ref):
    if ref is None: return None
    if ref.find('c:strRef',ns) is None and ref.find('c:numRef',ns) is None and ref.find('c:v',ns) is not None:
        return {'lit': ref.findtext('c:v',namespaces=ns)}
    pts=[]
    for c in ref.iter('{%s}numCache'%ns['c'],'{%s}strCache'%ns['c']):
        fmt=c.find('c:formatCode',ns)
        n=int(val(c,'c:ptCount') or 0); arr=[None]*n
        for p in c.findall('c:pt',ns): arr[int(p.get('idx'))]=p.find('c:v',ns).text
        return {'f':ref.findtext('.//c:f',namespaces=ns),'fmt':fmt.text if fmt is not None else None,'v':arr}
    return {'f':ref.findtext('.//c:f',namespaces=ns)}
def dlbls(el):
    d=el.find('c:dLbls',ns)
    if d is None: return None
    return {'showVal':val(d,'c:showVal'),'pos':val(d,'c:dLblPos'),'numFmt':val(d,'c:numFmt','formatCode'),'tx':txpr(d),'delete':val(d,'c:delete')}
r=etree.parse(sys.argv[1]).getroot()
out={'title':None}
pa=r.find('.//c:plotArea',ns)
out['plots']=[]
for ch in pa:
    tag=etree.QName(ch).localname
    if not tag.endswith('Chart'): continue
    p={'type':tag,'barDir':val(ch,'c:barDir'),'grouping':val(ch,'c:grouping'),'gap':val(ch,'c:gapWidth'),'overlap':val(ch,'c:overlap'),'axIds':[a.get('val') for a in ch.findall('c:axId',ns)],'dLbls':dlbls(ch),'varyColors':val(ch,'c:varyColors'),'series':[]}
    for s in ch.findall('c:ser',ns):
        sd={'tx':cache(s.find('c:tx',ns)),'fill':fill(s.find('c:spPr',ns)),'line':lnfill(s.find('c:spPr',ns)),'smooth':val(s,'c:smooth'),'dLbls':dlbls(s),
            'cat':cache(s.find('c:cat',ns)) or cache(s.find('c:xVal',ns)),'val':cache(s.find('c:val',ns)) or cache(s.find('c:yVal',ns))}
        m=s.find('c:marker',ns)
        if m is not None: sd['marker']={'symbol':val(m,'c:symbol'),'size':val(m,'c:size'),'fill':fill(m.find('c:spPr',ns)),'line':lnfill(m.find('c:spPr',ns))}
        dps=[]
        for dp in s.findall('c:dPt',ns): dps.append({'idx':val(dp,'c:idx'),'fill':fill(dp.find('c:spPr',ns))})
        if dps: sd['dPt']=dps
        p['series'].append(sd)
    out['plots'].append(p)
out['axes']=[]
for ax in pa:
    tag=etree.QName(ax).localname
    if not tag.endswith('Ax'): continue
    out['axes'].append({'type':tag,'id':val(ax,'c:axId'),'delete':val(ax,'c:delete'),'pos':val(ax,'c:axPos'),'min':val(ax,'c:scaling/c:min'),'max':val(ax,'c:scaling/c:max'),'orient':val(ax,'c:scaling/c:orientation'),'numFmt':val(ax,'c:numFmt','formatCode'),'major':ax.find('c:majorGridlines',ns) is not None,'gridLine':lnfill(ax.find('c:majorGridlines/c:spPr',ns)) if ax.find('c:majorGridlines',ns) is not None else None,'majorUnit':val(ax,'c:majorUnit'),'tickLbl':val(ax,'c:tickLblPos'),'tx':txpr(ax),'line':lnfill(ax.find('c:spPr',ns)),'crosses':val(ax,'c:crosses')})
lg=r.find('.//c:legend',ns)
out['legend']={'pos':val(lg,'c:legendPos'),'tx':txpr(lg)} if lg is not None else None
out['plotFill']=fill(pa.find('c:spPr',ns))
cs=r.find('c:chart',ns); out['autoTitleDeleted']=val(cs,'c:autoTitleDeleted')
out['chartFill']=fill(r.find('c:spPr',ns))
out['dispBlanksAs']=val(cs,'c:dispBlanksAs')
print(json.dumps(out,ensure_ascii=False))
