/** Competition Regulations, National Finals 2026, pp. 32–37. Line wraps normalised; band wording preserved. */
export const RUBRICS: Record<string, readonly string[]> = {
  "engineering-drawings": [
    "Little or no detail, Little or no annotation. No table of contents. No regulation compliance was shown.",
    "Basic views included. Some dimensions are included but not sufficient annotations. Insufficient regulation compliance was shown. A basic table of contents.",
    "Multiple views including First or Third-angle orthographic projection matching the final car. Some parts or materials are represented. Some Regulation compliance shown (eg T. 4.2 Virtual Cargo identification.) Good table of contents.",
    "First or Third-angle orthographic projection matching the final car and unrendered isometric view or similar. Additional views to show sufficient detail. Parts list/bill of materials. Excellent regulation compliance shown (eg T.4.2 Virtual Cargo identification.) Complete and ordered table of contents."
  ],
  "renders": [
    "Poor quality renders. Insufficient views.",
    "Multiple views. Some inconsistencies matching the final car.",
    "Multiple views. Good match to the final car Good render technique.",
    "Multiple views. Perfect match to the final car including branding. Realistic environment and lighting High-end render technique."
  ],
  "finish-assembly": [
    "Poor finish and assembly. No justification for intended quality and finish documented in the final page of the engineering drawings document.",
    "Reasonable finish with some inconsistencies. Reasonable assembly. Some justification for intended quality and finish is documented in the final page of the engineering drawings document.",
    "Good overall intended finish. Intended quality and assembly with attention to detail. Justification for intended quality and finish is well documented in the final page of the engineering drawings document.",
    "Intended quality, assembly and finish on all components is exceptional. The two cars are identical. Justification for intended quality and finish is comprehensively documented in the final page of the engineering drawings document."
  ],
  "design-concepts": [
    "Single or minimal concepts for car components with no links to research. No relevance to final car.",
    "Basic concepts of car components with limited links to research. Limited relevance to final car.",
    "Good technically inspired ideas that are relevant for different car components linked to research.",
    "Excellent technically inspired ideas for multiple car components with research-detailed. Relevance of the concept strongly justified."
  ],
  "3d-modelling": [
    "Minimal application of 3D modelling techniques. Only final design 3D modelled.",
    "Basic use of 3D modelling tools and techniques. More than 1 design included with different iterations.",
    "Good use of advanced 3D modelling tools, showcasing skill and technique. Dimensional constraints of the STEM RACING model block considered. Design approach explained. Design for manufacture considerations noted. (ie fillets, tolerance of machining).",
    "Expert use of a wide range of complex 3D modelling techniques, demonstrating exceptional skill and innovation. Design for manufacture directs process. (ie machining tool availability, fit clearances). Quality of CAD surfaces analyzed."
  ],
  "computer-aided-analysis": [
    "Poor choice and no justification of simulation parameters. Weak analysis with poorly presented/no results. No design choices made based on FEA/CFD study.",
    "Limited choice and justification of simulation parameters. Limited analysis and results. Little to no design choices made based on FEA/CFD study.",
    "Well-justified choice and understanding of simulation Good analysis with clear, well-presented results. Some design choices made based on FEA/CFD study.",
    "Excellent choice & understanding of simulation parameters. Detailed analysis with clear, well-presented results. Proven design improvements made based on FEA/CFD study."
  ],
  "cam-cnc": [
    "No or minimal evidence of CAM/CNC understanding or manufacturing.",
    "Basic evidence of CAM/CNC processes and manufacturing.",
    "Good use and understanding of CAM/CNC processes to achieve manufacturing goals. Manufacturing issues noted with limited problem solving.",
    "Evidence of excellent understanding of CAM/CNC technologies. Appropriate techniques and processes used to achieve manufacturing goals. Manufacturing issues discussed with innovative problem-solving solutions."
  ],
  "manufacturing-assembly": [
    "No or minimal manufacturing presented. No or minimal consideration of quality assurance and workplace safety documented. No or minimal justification of outsourcing.",
    "The manufacturing process is mentioned without detail. Basic consideration of quality assurance and workplace safety documented. Basic justification of outsourcing.",
    "Good manufacturing process and stages described. Good consideration of quality assurance and workplace safety documented. Appropriate use of manufacturing resources documented (i.e. tools, finishes, jigs, fixtures). Outsourcing clearly explained and justified.",
    "Details all manufacturing stages and processes. Quality assurance and workplace safety considerations evident. Appropriate outsourcing justified with make vs buy analysis."
  ],
  "research-development": [
    "No or limited evidence of R&D.",
    "Basic evidence of R&D with some principles considered.",
    "Some scientific & mathematical theories and principles considered. Logical research based design developments explained and justified.",
    "Relevant R&D throughout the entire product design & development cycle. Design concept developments refined and justified from research & test findings."
  ],
  "testing": [
    "No or little evidence of testing on the fully assembled car and individual components.",
    "Limited testing. Some evidence of method and outcomes on the fully assembled car and individual components.",
    "Good testing. Different evidence of method and outcomes. Some evidence of virtual and physical testing on the fully assembled car and individual components.",
    "Appropriate testing with excellent methods and outcomes documented. Comprehensive evidence of virtual and physical testing on the fully assembled car and individual components."
  ],
  "design-process-evaluation": [
    "No or limited Ideas or process evaluations at different stages. No or limited documentation of evaluation-linked improvement actions.",
    "Basic Ideas or process evaluations at different stages. Basic documentation of evaluation-linked improvement actions.",
    "Multiple Ideas or process evaluations at different stages. Good documentation of evaluation-linked improvement actions.",
    "Excellent ongoing idea evaluations linked to improvement actions. Comprehensive documentation of evaluation-linked improvement actions."
  ],
  "de-portfolio/document-presentation": [
    "Difficult to follow with basic presentation standard.",
    "Basic organization.",
    "Good and clear structure, well organized.",
    "High impact and professional throughout. Consistent and clear organization."
  ],
  "initiation-process": [
    "No or limited evidence of an Initiation process.",
    "Evidence of an Initiation process with goals and deliverables identified, leading to a basic scope statement.",
    "Evidence of an Initiation process including Kick-off meeting. Project charter created with goals and deliverables identified. Good scope statement developed, identifying acceptance criteria for each deliverable.",
    "Kick-off meeting evidenced. Detailed Project Charter created, clearly defining all deliverables. Comprehensive scope statement developed, identifying acceptance criteria for each deliverable."
  ],
  "project-schedule": [
    "No or limited evidence of tasks to be completed.",
    "Evidence of a project schedule, showing a breakdown of time required to complete essential tasks.",
    "Clear evidence of a project schedule and Work Breakdown Structure. Detailed Gantt chart created to identify all tasks, dependencies, and time estimations. Resource allocation is included for major project phases.",
    "Comprehensive project schedule with detailed Work Breakdown Structure and Gantt chart. All tasks, dependencies, and time estimations are clearly identified. Key dependencies are identified, and critical path analysis is included."
  ],
  "budget-resource": [
    "No or limited evidence of strategies to manage budget and/or resources.",
    "Some evidence of resources required and how they are to be acquired and managed. Some evidence of budgeting.",
    "Clear evidence of budgeting and use of basic accounting methods to track expenditure. Identification of where, when, and how resources are to be acquired and used. Initial cost estimates for major project components.",
    "Comprehensive budgeting with detailed cost breakdown and methods for tracking expenditure. Thorough resource management plan, including procurement strategies, resource allocation, and utilization forecasts. Cost-benefit analysis for key project decisions."
  ],
  "roles-responsibilities": [
    "No or limited evidence of clear roles and responsibilities within team.",
    "Team roles and responsibilities identified, with some evidence of task and/or activity breakdown.",
    "Team members identified and a structured team created with defined job functions and appropriate responsibilities. Evidence of a basic Responsibility Assignment ('RACI') Matrix.",
    "Highly structured team with clearly defined job functions, skill requirements, and detailed responsibilities. Comprehensive RACI Matrix covering all project activities. Evidence of a team development plan and strategies for managing team dynamics."
  ],
  "team-stakeholder-communications": [
    "No or limited evidence of engagement between team members and stakeholders.",
    "Evidence of a communication plan and engagements between team members and with stakeholders.",
    "Clear communication plan implemented between team members and stakeholders. Key stakeholders registered and reported to regularly. Multiple communication tools used effectively.",
    "Comprehensive communication strategy with tailored approaches for different stakeholder groups. Regular, documented communication with all stakeholders using diverse, appropriate channels. Evidence of feedback loops and continuous improvement in communication processes. Stakeholder engagement matrix utilized to manage relationships."
  ],
  "risk-management": [
    "No or limited evidence of risk identification and management.",
    "Evidence of risk identification and response management plans in place.",
    "Clear evidence identifying all relevant risks, area(s) of impact and response planning. Assessment of impact on resources, timing, scope and quality.",
    "Comprehensive risk management strategy including detailed risk register, risk analysis, and prioritization. Proactive risk strategies implemented with contingency plans. Regular risk reviews and updates throughout the project lifecycle. Evidence of opportunity management alongside risk management."
  ],
  "monitoring-controlling": [
    "No or limited or isolated project evaluation.",
    "Ongoing evaluation of most areas. Documented evidence of problems identified and suggested solutions.",
    "Regular 'Status Reports', documenting tasks signed off and highlighting areas of concern. Scope creep identified with a clear action plan for tasks that overrun. Key performance indicators (KPIs) tracked and reported.",
    "Regular and detailed project tracking processes consistently applied. Comprehensive 'Status Reports' include: Analysis of work completed versus resources used, Comparison of planned versus actual progress, Predictions of future project performance, Clear procedures for managing project changes, with all modifications documented."
  ],
  "marketing-strategy": [
    "Lack of coherent marketing strategy, poorly developed marketing materials, and minimal content relevance.",
    "Partially coherent marketing strategy, average quality marketing materials, needs enhancement in content relevance.",
    "Good marketing strategy, reasonably developed marketing materials, and satisfactory content relevance.",
    "Well-defined marketing strategy, high-quality marketing materials, and highly relevant content."
  ],
  "sponsorship-return": [
    "No or incomplete Sponsor/partner hierarchy. Limited understanding of sponsorship. No evidence of ROI.",
    "Basic Sponsor/partner hierarchy and benefits included. Partial understanding of sponsorship. Some evidence of return of investment (ROI) to relevant sponsors.",
    "A range of sponsor/partner hierarchy and benefits identified. Good understanding of sponsorship, reasonable investment, and satisfactory ROI to relevant sponsors.",
    "Sponsor/partner hierarchy and benefits detailed and justified. Range of relevant sponsors/partners showing mutually beneficial relationships. Creative activities linked to return of investment (ROI)."
  ],
  "digital-media-proficiency": [
    "Limited understanding and utilization of digital media platforms. Minimal engagement with audience, and ineffective content creation.",
    "Partial understanding and use of digital media platforms. Some evidence of strategy documented. Audience engagement needs improving.",
    "Good understanding and utilization of digital media platforms. Good execution in line with documented strategy. Reasonable engagement, and content creation.",
    "Strong understanding and effective utilization of digital media platforms in line with documented plans. High audience engagement, and impressive content creation."
  ],
  "sustainability": [
    "No or limited understanding and implementation of sustainable practices. No or minimal awareness of environmental impact.",
    "Partial understanding and inconsistent implementation of sustainable practices. Needs improvement in awareness of environmental impact. Some evidence of implementation.",
    "Good understanding and moderate implementation of sustainable practices. Some awareness of environmental impact. Implementation documented considering different factors such as economic, environmental, and social.",
    "Strong understanding and effective implementation of sustainable practices. High awareness of environmental impact and active involvement in sustainability initiatives considering economic, environmental, and social factors."
  ],
  "enterprise-portfolio/document-presentation": [
    "Poor formatting, lack of structure. Minimal visual appeal in the document.",
    "Average formatting with some structure. Needs improvement in the document visual appeal.",
    "Good formatting, structured document. Satisfactory document visual appeal. Good organization.",
    "Excellent formatting, well-structured document, and highly appealing visually. High impact and professional throughout. Consistent and clear organization."
  ],
  "pit-display-design": [
    "Limited planning and execution, lack of innovation, and minimal attention to detail in the design process.",
    "Some planning and execution. Insufficient innovation. Needs improvement in attention to design details. Some ideas development documented.",
    "Different ideas & justification of design. Good evidence of development considering factors including team identity, budget, sustainability and time constraints with consideration to functionality and user experience.",
    "A range of ideas, clearly justified, creative final design. Comprehensive evidence of development considering factors including team identity, budget, sustainability and time constraints with consideration to functionality and user experience."
  ],
  "pit-display-content": [
    "Repetition of Portfolio contents. Disorganised layout. Little or no evidence of marketing materials. Minimal information about the team's work.",
    "Partially informative content. The pit display is not enhanced by Multimedia or Marketing materials. The Pit display needs more clarity detailing the team's work.",
    "Good organisation and impact. Multimedia is used to enhance the display, with some marketing material on display. Clear and effective presentation and messaging about the team’s work.",
    "Clean, well-organised with high impact. Highly professional with attention to detail. Excellent integration of technology, multimedia and marketing materials. Comprehensive information about the team's work."
  ],
  "functionality-user-experience": [
    "Non-functional or poorly functional design, inconvenient user experience. Lacks impact, and minimal overall visitor impression.",
    "Basic functionality, average user experience, needs improvement in functionality and overall visitor impression.",
    "Good functionality, and satisfactory user experience. Innovative Pit display and positive visitor impression.",
    "Excellent functionality, seamless user experience, and impressive innovation across the Pit Display. A very positive impression on visitors."
  ],
  "overall-team-identity": [
    "Inconsistent, limited or obscure identity through project elements. Weak team cohesion, lack of shared identity.",
    "Partial team cohesion, and inconsistent shared identity through project elements.",
    "Good team identity is consistent through various project components e.g. car matches team uniform.",
    "Excellent and highly effective team identity. Team ‘brand’ consistently applied through all project elements."
  ],
  "engagement-presentation-dynamics": [
    "Monotonous presentation, lack of visual aids, and minimal interaction with audience. Poor delivery technique.",
    "Limited team dynamics, some visual aids. Limited delivery technique and interaction with the audience.",
    "Good team dynamics, effective visual aids, Good delivery and interaction with the audience.",
    "Excellent engagement, captivating and highly interactive delivery, and strong audience connection. Exceptional team dynamics, and impactful visual aids."
  ],
  "team-contribution": [
    "Single team member taking the lead in presentation.",
    "Minimal team participation during the presentation.",
    "Good contributions from most team members.",
    "Excellent teamwork with all members participating effectively."
  ],
  "content-quality": [
    "Irrelevant or outdated content, lack of depth, and poor relevance. Unclear explanations.",
    "Partially relevant content, some depth, needs improvement in quality and explanations.",
    "Relevant content, good depth, and reasonably high-quality information. Clear explanations.",
    "Highly relevant content, profound depth, and exceptional quality information with articulate explanations."
  ],
  "time-clarity-structure": [
    "Severe time management issues, with significant rushing or excessive time taken. Less than 8 minutes or more than 12 minutes. Incoherent structure, unclear message, and disorganized content.",
    "Time management issues are evident, with noticeable rushing or excessive time taken. Less than 9 minutes or more than 11 minutes. Partially clear structure, some coherence, needs better content organization.",
    "Good flow and time management of each topic with minimal rushing or excessive time taken. Clear structure, coherent flow, and organized content.",
    "Excellent time management and balance of each topic without exceeding the time limit. Excellent structure, crystal-clear message (concept), and highly organized content. Excellent attention to detail."
  ],
  "innovation": [
    "Little project innovation presented with no justifications.",
    "Average project innovations are described but with no justification.",
    "Good project innovations are described and justified and connected to competition elements.",
    "Excellent innovations related to competition elements, or other aspects with high positive project impact."
  ],
  "collaboration": [
    "None or Little collaboration with industry or higher education mentioned.",
    "Some collaboration with industry or higher education is mentioned.",
    "Good description of collaboration with industry and higher education.",
    "Excellent justification of collaborations with industry and higher education. Links to learning and project outcomes."
  ],
  "stem-racing-learning-journey": [
    "No or limited real reflections discussed.",
    "Basic explanation of some learning outcomes for some team members.",
    "Good explanation of some learning outcomes for all team members.",
    "A range of personal, life-long learning and career skills acquired and identified as project outcomes for all team members."
  ]
};

export const BAND_LABELS = ['Low', 'Medium-Low', 'Medium-High', 'High'] as const;

export const NOMINATION_AWARDS = [
  { id: 'verbal-presentation', name: 'Verbal Presentation Award' },
  { id: 'team-identity', name: 'Team Identity Award' },
  { id: 'sustainability', name: 'Sustainability Award' },
  { id: 'innovative-thinking', name: 'Innovative Thinking Award' },
  { id: 'women-in-motorsport', name: 'FIA Women in Motorsport Award' },
  { id: 'chair-recognition', name: 'Chair of Judges Recognition of Achievement Award' },
] as const;
