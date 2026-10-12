const ROWS: [string, string, string][] = [
  ['ספת קטיפה (Glam Velvet Sofa)', 'Eric Chadwick, © 2021 Wayfair, LLC', 'CC BY 4.0'],
  ['ספה קלאסית מעץ ועור (Sheen Wood Leather Sofa)', 'Fran Calvente; שיפורים: Eric Chadwick, © 2024 Darmstadt Graphics Group GmbH', 'CC BY 4.0'],
  ['כורסת דמשק (Chair Damask Purplegold)', 'Eric Chadwick, © 2021 Wayfair', 'CC BY 4.0'],
  ['כורסת קטיפה (Sheen Chair)', 'Eric Chadwick, Wayfair, LLC', 'CC0'],
  ['פוף משי (Specular Silk Pouf)', 'Eric Chadwick, © 2023 Wayfair, LLC', 'CC BY 4.0'],
  ['אגרטלי זכוכית עם פרחים (Glass Vase Flowers)', 'Eric Chadwick, Rico Cilliers', 'CC0'],
  ['צמח בעציץ (Diffuse Transmission Plant)', 'Rico Cilliers; חומרים: Eric Chadwick, © 2024 Darmstadt Graphics Group GmbH', 'CC BY 4.0'],
  ['צלחת זיתים (Iridescent Dish With Olives)', 'Eric Chadwick, © 2020 Wayfair, LLC', 'CC BY 4.0'],
  ['מנורת קיר (Anisotropy Barn Lamp)', 'Eric Chadwick, © 2023 Wayfair, LLC', 'CC BY 4.0'],
  ['רצפת עץ סרוקה', 'three.js examples', 'MIT'],
  ['נופים מהחלון וסביבת תאורה', 'Poly Haven', 'CC0'],
];

export default function Credits() {
  return (
    <main className="page" style={{ maxWidth: 900 }}>
      <div className="dash-head">
        <div>
          <div className="eyebrow">קרדיטים</div>
          <h1>נכסים תלת-ממדיים אמיתיים</h1>
          <p>הדגמים, החומרים והנופים בסיורים הם סריקות וצילומים אמיתיים בשימוש חופשי. אלה היוצרים והרישיונות.</p>
        </div>
      </div>
      <table className="present-table" style={{ marginTop: 24 }}>
        <tbody>
          {ROWS.map(([what, who, lic]) => (
            <tr key={what}>
              <td>
                <b style={{ fontWeight: 600 }}>{what}</b>
                <div className="small muted">{who}</div>
              </td>
              <td>{lic}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 18 }}>
        מקור הדגמים: Khronos glTF Sample Assets. הדגמים עברו דחיסה בלבד, בלי שינוי בתוכן.
      </p>
    </main>
  );
}
