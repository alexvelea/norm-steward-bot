import type { BuildingId } from "../../contract";

/** Original vector buildings, kept small enough to read as village-map markers. */
export function BuildingArt({ id }: { id: BuildingId }) {
  const stone = "#b3a384",
    shadow = "#73664f",
    roof = "#755343",
    dark = "#382e25",
    gold = "#d3ac60";
  const tower = id === "hall" || id === "watchtower" || id === "court";
  return (
    <svg viewBox="0 0 96 80" fill="none" aria-hidden="true">
      <ellipse cx="48" cy="70" rx="37" ry="9" fill="#000" opacity=".22" />
      {id === "mine" || id === "quarry" ? (
        <>
          <path d="M9 65 19 36 37 18 55 28 70 17 87 58 80 70Z" fill={id === "mine" ? "#6f7974" : "#a3a395"} />
          <path d="m37 18 5 24-13 12 8 14H9l10-32Z" fill="#54615a" opacity=".5" />
          {id === "mine" ? (
            <>
              <path d="M38 68V46q13-21 26 0v22Z" fill={dark} />
              <path d="M34 67V43h34v24M30 43h42" stroke={roof} strokeWidth="5" />
              <path d="m48 66 3-13h8l5 13M40 76l13-23M68 76 57 53" stroke={shadow} strokeWidth="2" />
            </>
          ) : (
            <>
              <path d="m25 53 17-9 15 10-16 10Z" fill="#d0c6ae" />
              <path d="m49 65 15-10 16 10-16 8Z" fill="#b7ad96" />
              <path d="m60 26 8 29M56 31l16-4" stroke={dark} strokeWidth="3" />
            </>
          )}
        </>
      ) : id === "wall" ? (
        <>
          <path d="m12 36 64-8 10 9-64 9Z" fill="#d0bea0" />
          <path d="m12 36 64-8v34l-64 9Z" fill={stone} />
          <path d="m76 28 10 9v33l-10-8Z" fill={shadow} />
          <path d="M17 36v-9h9v8m7-1v-9h9v8m7-1v-9h9v8m7-1v-9h9v8" stroke={stone} strokeWidth="5" />
          <path d="M39 66V51q8-11 16-2v15Z" fill={dark} />
        </>
      ) : id === "farm" ? (
        <>
          <path d="m6 54 34-8 45 18-34 13Z" fill="#8f8f49" />
          <path d="m15 57 39 15m-27-19 38 14M39 49l37 14" stroke="#c2ac63" strokeWidth="2" />
          <path d="m35 55 5-36h16l6 36Z" fill={stone} />
          <path d="m35 21 13-13 14 13Z" fill={roof} />
          <path d="M48 28v-16m0 16 17 12M48 28 32 41M48 28l-4 23" stroke={dark} strokeWidth="3" />
          <circle cx="48" cy="28" r="4" fill={gold} />
        </>
      ) : (
        <>
          {tower ? (
            <>
              <path d="M27 65V29h39v36l-20 7Z" fill={stone} />
              <path d="m46 29 20-6v42l-20 7Z" fill={shadow} />
              {id === "watchtower" ? (
                <>
                  <path d="M30 30V16h33v14Z" fill={stone} />
                  <path d="m25 16 21-12 22 12Z" fill={roof} />
                  <path d="M37 20h5v9h-5m10-9h5v9h-5" fill={dark} />
                </>
              ) : (
                <>
                  <path d="M26 30V20h9v7h9v-7h9v7h9v-7h5v10" fill={stone} />
                  <path d="M45 19V4m0 1 18 5-18 4" stroke={gold} strokeWidth="2" />
                  <path d="M17 62V40h13v25m35-27h12v26H65" fill={stone} />
                  <path d="m14 40 10-14 10 14m27-2 10-15 10 15" fill={roof} />
                </>
              )}
              <path d="M39 69V52q7-11 14 0v17Z" fill={dark} />
              <path d="M35 37h5v8h-5m14-8h5v8h-5" fill={dark} />
            </>
          ) : (
            <>
              <path d="M18 61V37l28-13 32 17v22L46 73Z" fill={stone} />
              <path d="m46 44 32-3v22L46 73Z" fill={shadow} />
              <path d="m11 38 32-23 41 23-34 14Z" fill={roof} />
              <path d="m43 15 7 37 34-14Z" fill="#584638" />
              <path d="M29 65V50h10v19Z" fill={dark} />
              <path d="M56 51h7v8h-7m-33-11h6v7h-6" fill={gold} />
              {id === "smithy" || id === "workshop" ? (
                <>
                  <path d="M62 27V10h9v22" fill={shadow} />
                  <path d="M65 6q-5-7 1-9" stroke="#c8bca6" strokeWidth="3" opacity=".5" />
                  <path d="m58 68 9-8 14 5-8 8Z" fill={dark} />
                </>
              ) : null}
              {id === "lumberyard" ? (
                <>
                  <path d="m9 66 21-5m-18 9 21-5m-20 9 21-5" stroke="#9a7750" strokeWidth="5" />
                  <path d="m70 52 8-18 8 18Z" fill="#435e43" />
                </>
              ) : null}
              {id === "market" ? (
                <>
                  <path d="m49 46 32-10 7 13-32 12Z" fill={gold} />
                  <path d="m58 43 6 15m5-18 6 14" stroke="#eee0b5" strokeWidth="5" />
                  <path d="M57 60v14m28-22v14" stroke={dark} strokeWidth="3" />
                </>
              ) : null}
              {id === "stable" ? <path d="M59 66V52h15v16m-9-16v-6l8 2v6" stroke={dark} strokeWidth="4" /> : null}
              {id === "barracks" ? (
                <>
                  <path d="M14 36V14m0 0 14 5-14 4" stroke={gold} strokeWidth="2" />
                  <path d="m59 62 12-9m-11 0 12 10" stroke={gold} strokeWidth="2" />
                </>
              ) : null}
              {id === "storehouse" ? (
                <>
                  <path d="M61 68V56h13v11Z" fill="#ad8d55" />
                  <path d="M64 57v10m6-11v10" stroke={dark} />
                </>
              ) : null}
              {id === "cellar" ? <path d="m10 61 17-5 12 8-17 6Z" fill="#65513b" stroke={dark} strokeWidth="2" /> : null}
            </>
          )}
        </>
      )}
    </svg>
  );
}
