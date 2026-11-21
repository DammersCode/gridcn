/** One car sold by a dealership. */
export type SaleRow = {
  id: string;
  soldOn: string;
  region: string;
  dealership: string;
  salesperson: string;
  make: string;
  model: string;
  customer: string;
  price: number;
  discount: number;
  financed: boolean;
};

export const REGIONS = ["North", "South", "East", "West"];
export const DEALERSHIPS = ["Northgate Motors", "Pine Ridge Cars", "Bayview Autos", "Southfield Motors", "Eastbrook Cars", "Harbor Point Motors", "Westlake Autos", "Canyon Road Motors"];
export const MAKES = ["Kestrel", "Marlow", "Nordvik", "Solenne", "Vantor"];
const SALESPEOPLE = ["Dana Brooks", "Eli Moreno", "Fern Walsh", "Gus Ortega", "Hana Ito", "Ivan Petrov", "Jade Lin", "Kofi Mensah", "Lena Fischer", "Milo Grant", "Nia Duarte", "Omar Aziz", "Pia Lund", "Raul Vega", "Sana Mir", "Theo Clark"];
const MODELS = [["Brook", "Glide", "Summit"], ["Coast", "Harbor", "Tide"], ["Birch", "Fjord", "Frost"], ["Dawn", "Lumen", "Opal"], ["Ember", "Flint", "Quarry"]];
// Unequal shares per region and a different make mix in each region, so group totals differ.
const REGION_SLOTS = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3];
const MAKE_MIX = [
  [0, 0, 0, 1, 2, 3, 4, 1],
  [1, 1, 1, 2, 0, 3, 4, 2],
  [2, 2, 3, 3, 3, 0, 1, 4],
  [4, 4, 4, 3, 0, 1, 2, 4],
];
const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Robin"];
const LAST = ["Smith", "Garcia", "Chen", "Patel", "Novak", "Okafor", "Larsen", "Rossi", "Kim", "Silva", "Meyer", "Haddad"];

/** `count` fictional car sales. Index arithmetic instead of `Math.random` keeps the server and client markup equal. */
export const generateSales = (count: number): SaleRow[] =>
  Array.from({ length: count }, (_, index) => {
    const region = REGION_SLOTS[index % REGION_SLOTS.length]!;
    const mix = MAKE_MIX[region]!;
    const make = mix[Math.floor(index / REGION_SLOTS.length) % mix.length]!;
    const model = Math.floor(index / 80) % 3;
    const dealership = region * 2 + (Math.floor(index / 7) % 3 === 0 ? 1 : 0);
    return {
      id: `sale-${index + 1}`,
      soldOn: new Date(Date.UTC(2025, 0, 1 + ((index * 7) % 365))).toISOString().slice(0, 10),
      region: REGIONS[region]!,
      dealership: DEALERSHIPS[dealership]!,
      salesperson: SALESPEOPLE[dealership * 2 + (Math.floor(index / 13) % 2)]!,
      make: MAKES[make]!,
      model: MODELS[make]![model]!,
      customer: `${FIRST[Math.floor(index / 5) % FIRST.length]!} ${LAST[(index * 7) % LAST.length]!}`,
      price: 21000 + make * 6000 + model * 9000 + ((index * 37) % 41) * 100,
      discount: ((index * 7) % 13) * 250,
      financed: index % 3 !== 0,
    };
  });
