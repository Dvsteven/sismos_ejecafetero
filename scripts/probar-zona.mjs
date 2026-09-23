// Verifica que el polígono incluya/excluya las ciudades esperadas.
import { dentroDeZona } from '../netlify/functions/lib/zona.mjs';
const casos = [
  ['Pereira', 4.8133, -75.6961, true], ['Manizales', 5.0703, -75.5138, true],
  ['Armenia', 4.5339, -75.6811, true], ['Ibagué', 4.4389, -75.2322, true],
  ['Tuluá', 4.0847, -76.1954, true], ['Honda', 5.2044, -74.7359, true],
  ['Girardot', 4.3031, -74.8044, true], ['Salamina', 5.4031, -75.4869, true],
  ['Istmina', 5.1606, -76.6844, true], ['San José del Palmar', 4.8964, -76.2342, true],
  ['Medellín', 6.2442, -75.5812, false], ['Cali', 3.4516, -76.532, false],
  ['Bogotá', 4.711, -74.0721, false], ['Quibdó', 5.6947, -76.6611, false],
  ['Buenaventura', 3.8801, -77.0312, false], ['Tunja', 5.5353, -73.3678, false],
];
let fallas = 0;
for (const [n, lat, lon, esperado] of casos) {
  const r = dentroDeZona(lat, lon);
  if (r !== esperado) fallas++;
  console.log(`${r === esperado ? 'ok ' : 'MAL'} ${n.padEnd(20)} ${r ? 'dentro' : 'fuera'}`);
}
process.exit(fallas ? 1 : 0);
