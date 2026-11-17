// The opening ceremony, in the order it is shown. Edit, add or remove lines here.
//   kind "idle"       the holding screen
//   kind "seats"      a centred line (text) with a smaller line under it (small)
//   kind "title"      the event logo large, with one line of text under it
//   kind "card"       a text-track card: title, and an optional smaller line (small)
//   kind "presenter"  the presenter slide. With no "presenter" given it uses the one in awards/awards.js;
//                     or give your own:  presenter: {name: "…", role: ["…", "…"], photo: "assets/…jpg"}
//   teams: true       one walk-on card for every team, in team-number order
// label is what the control page calls the line.
window.OPENING = [
  {kind: "idle",      label: "Holding screen"},
  {kind: "seats",     label: "Please take your seats", text: "Please take your seats", small: "The opening ceremony will begin shortly"},
  {kind: "title",     label: "Title: Opening Ceremony", text: "Opening Ceremony"},
  {kind: "card",      label: "Welcome", title: "Welcome", small: "STEM Racing India Regional Finals"},
  {kind: "presenter", label: "Host"},
  {kind: "card",      label: "Meet the teams", title: "Meet the teams"},
  {teams: true},
  {kind: "card",      label: "Good luck to all our teams", title: "Good luck to all our teams"},
  {kind: "idle",      label: "Holding screen"}
];
