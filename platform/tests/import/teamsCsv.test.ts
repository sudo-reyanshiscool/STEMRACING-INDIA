import { describe, expect, it } from 'vitest';
import { parseTeamCsv } from '../../src/import/teamsCsv';

const parse = (s: string) => parseTeamCsv(s);
describe('team CSV import', () => {
  it('handles BOMs, CRLF, heading aliases, quoted commas and leading zeros', () => {
    expect(parse('\uFEFFTeam Number,Team Name,School or Club\r\n001,"Nitro, Racing","School, Delhi"\r\n').teams)
      .toEqual([{number:'001',name:'Nitro, Racing',school:'School, Delhi'}]);
  });
  it('keeps escaped quotes and quoted line breaks', () => {
    const r=parse('number,name,school\n01,"Team ""Nitro""","First line\nSecond line"\n');
    expect(r.errors).toEqual([]);expect(r.teams[0]).toEqual({number:'01',name:'Team "Nitro"',school:'First line\nSecond line'});
  });
  it('accepts optional school, blank lines, and ignores extra columns explicitly', () => {
    const r=parse('\nnumber,name,city\n3,Three,Delhi\n\n4,Four,Mumbai\n');
    expect(r.errors).toEqual([]);expect(r.teams.map((t)=>t.school)).toEqual(['','']);expect(r.ignoredColumns).toEqual(['city']);
    expect(parse('number,name\n3,Three').teams[0].school).toBe('');
  });
  it('rejects duplicate numbers both in the file and in the event, ignoring case and surrounding spaces', () => {
    const r=parseTeamCsv('number,name\n a1 ,Alpha\nA1,Again\n2,Two',[{number:' 2 '}]);
    expect(r.errors.map((e)=>e.row)).toEqual([3,4]);expect(r.errors[0].message).toContain('row 2');expect(r.errors[1].message).toContain('already exists');
  });
  it('reports physical row numbers after multiline cells', () => {
    const r=parse('number,name,school\n1,One,"A\nB"\n2,,C');
    expect(r.errors).toEqual([{row:4,message:'Team name is required.'}]);
  });
  it('rejects unclosed quotes, quotes in unquoted fields and trailing text after a quote', () => {
    for (const row of ['1,"Open','1,Ni"tro','1,"Nitro"oops']) expect(parse(`number,name\n${row}`).errors.length).toBeGreaterThan(0);
  });
  it('rejects missing or repeated required headings, malformed rows and empty files', () => {
    for (const csv of ['', 'number,name', 'name,school\nOne,School','number,team_number,name\n1,1,One','number,name\n1,One,Extra']) expect(parse(csv).errors.length).toBeGreaterThan(0);
  });
  it('validates lengths, treats formulas and HTML as inert text, and does not coerce numeric-looking names', () => {
    expect(parse('number,name\n001,=SUM(A1:A2)\n002,<script>alert(1)</script>').teams).toHaveLength(2);
    for (const [number,name,school] of [['x'.repeat(13),'Team',''],['1','x'.repeat(81),''],['1','Team','x'.repeat(121)]]) {
      expect(parse(`number,name,school\n${number},${name},${school}`).errors.length).toBeGreaterThan(0);
    }
  });
  it('limits import size and counts teams rather than blank lines', () => {
    expect(parse('number,name\n'+'\n'.repeat(1100)+'1,One').teams).toHaveLength(1);
    expect(parse('number,name\n'+Array.from({length:1001},(_,i)=>`${i},Team ${i}`).join('\n')).errors[0].message).toContain('1000');
  });
  it('treats inherited property names as unknown headers', () => {
    const r=parse('number,name,constructor\n1,One,Ignored');expect(r.errors).toEqual([]);expect(r.ignoredColumns).toEqual(['constructor']);
  });
});

it('accepts manager email aliases, normalises addresses and preserves leading zeros',()=>{
 const result=parseTeamCsv('Team Number,Team Name,Team Manager Email\n001,SUPERCHARGED, Manager@School.org ');
 expect(result.errors).toEqual([]);expect(result.teams[0]).toMatchObject({number:'001',managerEmail:'manager@school.org'});
 for(const email of ['', 'not-an-email', 'two@example.com;other@example.com'])expect(parseTeamCsv(`number,name,manager_email\n001,One,${email}`).errors).not.toHaveLength(0);
});
