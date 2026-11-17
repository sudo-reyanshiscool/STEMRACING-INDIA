// The awards, in the order they are presented. Edit names or order here.
// bg:    which animated gradient sits behind the award (see ../shared/sr-background.js). Leave out to cycle.
// race:  a card shown before the award, for something that happens live (the knockout final).
// top:   true for the final, biggest reveal.
// nominees: false for awards announced without a nominees screen (the race result and the podium).
window.SHOW = {
  title: "Awards Ceremony",
  seats: "Please take your seats",
  seatsSmall: "The awards ceremony will begin shortly",
  close: "Congratulations to all our teams",
  // holding: the opening screen, the moving background with the logo looping. videos: a placeholder before the title screen. presenter: shown after the title
  holding: "Holding screen",
  videos: "Videos",
  presenter: {name: "Shubham Taneja", role: ["Head of Competitions", "STEM Racing India"], photo: "assets/presenter-shubham.jpg"}
};
window.AWARDS = [
  {id: "fastest-car",    name: "Fastest Car Award"},
  {id: "engineered-car", name: "Best Engineered Car"},
  {id: "scrutineering",  name: "Scrutineering Award"},
  {id: "research",       name: "Research & Development Award"},
  {id: "innovative",     name: "Innovative Thinking Award"},
  {id: "sustainability", name: "Sustainability Award"},
  {id: "project",        name: "Project Management Award"},
  {id: "sponsorship",    name: "Sponsorship & Marketing Award"},
  {id: "digital-media",  name: "Digital Media Award"},
  {id: "team-identity",  name: "Team Identity Award"},
  {id: "pit-display",    name: "Pit Display Award"},
  {id: "verbal",         name: "Verbal Presentation Award"},
  {id: "newcomer",       name: "Best Newcomer"},
  {id: "collaboration",  name: "Best Collaboration"},
  {id: "knockout",       name: "Knockout Champions", bg: "hot", race: "Knockout Final", raceSmall: "Live on track", nominees: false},
  {id: "third",          name: "Third Place", place: 3, bg: "pink-orange", nominees: false},
  {id: "second",         name: "Second Place", place: 2, bg: "blue", nominees: false},
  {id: "champions",      name: "Regional Champions", place: 1, bg: "orange-yellow", top: true, nominees: false}
];
