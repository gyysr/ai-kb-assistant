import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const outPath = path.join(__dirname, 'sample-policy.pdf');

const sections = [
  {
    title: '1. Expense Reimbursement Policy',
    points: [
      'All expense claims must be submitted through the finance portal within 30 days of the expense date. Claims submitted after the deadline will not be reimbursed unless the employee provides a written explanation approved by the department director. Finance processes approved claims every Friday.',
      'Business meals are reimbursed up to 200 CNY per person. Employees must attach the original itemized receipt and note the names of all attendees. Alcohol is not reimbursable under any circumstances, and team celebrations require prior approval from the HR department.',
      'Taxi fares are reimbursable when public transportation is unavailable or when carrying equipment. Employees should provide the taxi receipt with the date and route clearly visible. Ride-hailing app receipts printed from the app are also accepted by the finance team.',
      'Hotel accommodation is capped at 500 CNY per night in tier-one cities and 350 CNY per night in other cities. The cap includes breakfast and taxes. Employees staying with friends or family may claim a lodging allowance of 150 CNY per night with a signed statement.',
      'Air travel should be booked in economy class at least seven days in advance to obtain discounted fares. Upgrades to premium economy are permitted for flights longer than four hours, but business class requires written approval from the vice president of the company.',
      'Train travel is reimbursed for second-class seats on high-speed rail. First-class seats are allowed for journeys exceeding six hours. Employees are encouraged to book through the corporate travel account to take advantage of the negotiated corporate discount rates.',
      'Office supplies under 100 CNY may be purchased directly and reimbursed with a receipt. Purchases above 100 CNY require a purchase request submitted to the administration team at least three business days before the purchase is planned to take place.',
      'Client entertainment expenses require the name of the client company, the attendees, and the business purpose documented on the claim form. Entertainment expenses above 1000 CNY require pre-approval from both the finance manager and the sales director.',
      'Annual expense audits are conducted by an external accounting firm each January. Employees must retain original receipts for at least two years. Missing documentation may result in the expense being deducted from future salary payments of the employee.',
      'Any employee who suspects expense fraud should report it to the compliance hotline. The company investigates all reports within ten business days and protects whistleblowers from retaliation of any kind, in line with the code of conduct.',
    ],
  },
  {
    title: '2. Business Travel Policy',
    points: [
      'Business trips require approval from the direct manager at least five business days before departure. The travel request must include the purpose, destination, estimated budget, and expected outcomes of the trip. Emergency trips may be approved by phone within 24 hours.',
      'The daily travel allowance is 150 CNY for meals and incidentals. No receipts are required for the daily allowance itself, but all hotel and transport receipts must still be submitted separately through the standard expense claim process after the trip ends.',
      'Travel insurance is mandatory for all international trips and is arranged automatically by the administration team when the trip is approved. Domestic trips are covered by the corporate insurance policy, which includes medical emergencies and trip cancellation.',
      'Employees may extend a business trip for personal leave, but must pay the fare difference themselves. The company only covers the return date originally approved, and any changes to the return flight must be coordinated with the travel agency in advance.',
      'Luggage allowance follows the airline standard for economy class. Excess baggage fees for business equipment or product samples are reimbursable with a note from the project manager explaining why the materials had to travel with the employee.',
      'Ground transportation between the airport and the hotel should use public transport or the company shuttle where available. Taxis are acceptable for arrivals after 10 PM or when the employee is carrying large amounts of equipment or confidential materials.',
      'Travelers must register their itinerary in the corporate travel system before departure. This allows the security team to locate employees quickly during emergencies such as natural disasters, political unrest, or public health incidents in the destination region.',
      'Accommodation bookings must use the corporate hotel partners listed in the travel portal. These hotels offer negotiated rates, free cancellation, and consolidated monthly billing. Exceptions require a documented reason such as proximity to the client site.',
      'Trip reports summarizing the outcomes, client feedback, and follow-up actions are due within three business days of returning. The report should be uploaded to the project workspace and linked in the expense claim so finance can reconcile the trip budget.',
      'Frequent flyer miles and hotel loyalty points earned on business travel belong to the employee. However, upgrades purchased with personal miles for business flights require manager approval, and award tickets do not qualify for the daily travel allowance.',
    ],
  },
  {
    title: '3. Remote Work Policy',
    points: [
      'Employees may work remotely up to three days per week with manager approval. The arrangement must be documented in the HR system and reviewed every six months. New employees are expected to work on-site for their first month to complete onboarding.',
      'Remote employees must be reachable during core hours from 10 AM to 4 PM via the company chat and video conferencing tools. Response time to direct messages is expected within one hour during these core collaboration hours.',
      'The company provides a one-time home office stipend of 800 CNY for a chair, desk, or monitor. Internet costs are reimbursed up to 100 CNY per month with a service provider invoice. Additional equipment must be requested through the IT department.',
      'Information security requirements apply equally in the home office. Confidential documents must never be stored on personal devices, and screens should be locked whenever the employee steps away. VPN access is required for all internal system connections.',
      'Managers hold weekly one-on-one check-ins with remote team members. Performance is evaluated on output and deliverables rather than online status, and employees are not required to keep their status green outside the agreed core hours.',
      'Remote work from another city or country for more than two weeks requires VP approval, as it may have tax and legal implications. The company currently supports remote work only within the country where the employment contract was signed.',
      'Sick days while working remotely follow the same reporting procedure as office sick days: notify the manager before 10 AM and record the absence in the HR system. A medical certificate is required for absences longer than two consecutive days.',
      'Team days are scheduled on the first Monday of each month when all local employees are expected in the office for planning sessions and team building. Attendance is mandatory except for employees on approved leave or business travel.',
      'Remote workers must maintain a safe and ergonomically sound workspace. The company offers an annual ergonomic assessment via video call, and any work-related injury at home must be reported to HR within 24 hours of the incident.',
      'The remote work policy is reviewed quarterly based on team productivity data and employee surveys. The company reserves the right to adjust remote arrangements for individuals whose role requires physical presence in the laboratory or workshop.',
    ],
  },
  {
    title: '4. Annual Leave and Holidays',
    points: [
      'Full-time employees receive 15 days of paid annual leave per year. Employees who have served more than five years receive 20 days. Leave accrues monthly and may be carried over up to five days into the first quarter of the following year.',
      'Annual leave requests require manager approval at least three business days in advance, except in emergencies. Teams should coordinate to ensure at least half of the team remains available during peak business periods such as product launches.',
      'The company observes all national public holidays. When a holiday falls on a weekend, the following Monday is granted as a substitute rest day in accordance with the official government holiday schedule published each year.',
      'Sick leave is separate from annual leave. Employees receive up to ten paid sick days per year, with a medical certificate required for absences longer than two days. Sick days beyond ten are covered by the social insurance program.',
      'Parental leave follows national regulations: 158 days of maternity leave and 15 days of paternity leave. Additional unpaid parental leave of up to one year is available to either parent with approval, and the employee returns to the same or an equivalent position.',
      'Employees may take up to three days of paid bereavement leave for the death of an immediate family member. One additional day of unpaid leave is available for travel to attend the funeral when it takes place in another province.',
      'Marriage leave of three days is granted upon registration of marriage, plus an extra day if the wedding banquet is held in another city. The leave should be scheduled within six months of the marriage registration date.',
      'Leave balances are visible in the HR self-service portal and updated in real time. Managers are responsible for ensuring their team members take adequate rest, and the HR team sends quarterly reminders to employees with high unused balances.',
      'Unused annual leave at year end is compensated at the regular daily rate if the company was unable to approve a requested leave due to business needs. Voluntarily unused leave is forfeited after the first-quarter carry-over window closes.',
      'Public holiday on-call duty is voluntary and compensated with a day of compensatory leave plus the statutory holiday pay premium. The on-call schedule is published two weeks in advance by the operations team.',
    ],
  },
  {
    title: '5. IT Security and Acceptable Use',
    points: [
      'All employees receive a unique account and must authenticate through multi-factor authentication for remote access. Sharing accounts or passwords is strictly prohibited and may result in disciplinary action up to and including termination of employment.',
      'Workstations must be locked whenever unattended. Full disk encryption is enabled on all company laptops by default, and employees may not disable encryption, antivirus software, or the device management profile installed by the IT department.',
      'Company data must be stored only in approved systems: the corporate cloud drive, the code repository, or the database servers. Personal USB drives, personal cloud accounts, and personal email must never be used for company data.',
      'Phishing simulations are conducted quarterly. Employees who click simulated phishing links complete a mandatory refresher training. Reporting a suspected real phishing email to the security team within one hour earns recognition in the security newsletter.',
      'Software installation on company devices is restricted to the approved software catalog. Requests for new software are reviewed by IT within five business days. Unauthorized software is removed automatically by the device management system.',
      'Public Wi-Fi usage requires the corporate VPN to be active at all times. Employees traveling internationally must use the travel laptop profile, which enforces additional encryption and disables automatic cloud synchronization of sensitive folders.',
      'Security incidents, including lost devices, suspicious emails, or accidental data disclosure, must be reported to the security team within two hours of discovery. Employees who report promptly are protected under the no-blame incident reporting policy.',
      'Email retention follows legal requirements: business correspondence is retained for three years, and financial records for ten years. Employees should not delete work emails manually; the archiving system handles retention automatically.',
      'Personal use of company equipment is permitted within reasonable limits, such as occasional personal browsing during breaks. Cryptocurrency mining, file sharing of copyrighted media, and accessing inappropriate content are prohibited at all times.',
      'Access to production systems is granted on the principle of least privilege and reviewed quarterly. Privileged access requires a second approver, and all administrative actions on production servers are logged and audited monthly by the security team.',
    ],
  },
  {
    title: '6. Code of Conduct and Ethics',
    points: [
      'All employees, officers, and contractors must act with integrity in every business dealing. Gifts from business partners are limited to items under 200 CNY; anything above must be declared to the compliance office and either returned or registered in the gift log.',
      'Conflicts of interest must be disclosed annually and whenever circumstances change. Employees may not hold financial interests in competitor companies or suppliers without written approval from the ethics committee of the company.',
      'Harassment and discrimination of any kind are prohibited, including based on gender, age, ethnicity, religion, or disability. Concerns may be raised through the confidential hotline or directly to HR, and all reports are investigated within ten business days.',
      'Competition law compliance requires that employees never discuss pricing, market allocation, or bidding strategies with competitors. Industry conference conversations must remain technical, and any suspicious contact should be reported to the legal team.',
      'Insider trading rules prohibit buying or selling securities of partner or competitor companies while in possession of material non-public information obtained through work. This obligation continues for twelve months after employment ends.',
      'Accurate record keeping is mandatory. Falsifying sales figures, test results, timesheets, or expense claims constitutes a serious violation. Business records must reflect the true nature of transactions without exception of any kind.',
      'Social media statements about the company, its products, or its partners must be clearly identified as personal opinions. Employees may not disclose confidential information in public forums, even in private groups or anonymous accounts.',
      'Suppliers and partners are held to the same ethical standards through the vendor code of conduct, which covers labor practices, environmental impact, and anti-corruption. Contracts include audit rights and termination clauses for ethical violations.',
      'Violations of the code of conduct may result in disciplinary measures ranging from a formal warning to termination, depending on severity. Serious violations such as fraud or harassment may also be reported to law enforcement authorities.',
      'The ethics committee meets monthly to review the whistleblower reports, gift declarations, and conflict disclosures. Employees may request a confidential consultation with any committee member regarding ethical dilemmas they encounter in their work.',
    ],
  },
  {
    title: '7. Health and Safety',
    points: [
      'Every employee has the right to a safe workplace and the duty to report hazards immediately. Emergency exits must remain unobstructed at all times, and the monthly fire drill participation is mandatory for all staff working in the office.',
      'First aid kits are located on every floor near the elevator lobby, and ten certified first responders are on staff. The occupational health clinic on the ground floor operates from 9 AM to 5 PM on all business days without exception.',
      'Ergonomic assessments are available free of charge through the HR portal. Employees experiencing repetitive strain symptoms should request an assessment within one week, and adjustable desks are available in the shared workspace area.',
      'Work-related injuries must be reported to the safety officer within 24 hours, no matter how minor. The company covers all medical expenses for injuries occurring during work activities, including injuries during business travel or approved remote work.',
      'Mental health support includes eight free confidential counseling sessions per year through the employee assistance program. The service is completely confidential, and no usage information is shared with managers or the HR department.',
      'Air quality monitors are installed on every floor, and outdoor activity is suspended when the air quality index exceeds 200. Masks and air purifiers are available from the administration desk on all poor air quality days.',
      'Smoking is permitted only in the designated outdoor area at least ten meters from the building entrance. Electronic cigarettes follow the same restriction, and violations are handled under the progressive discipline policy.',
      'New employees complete safety induction training during their first week, covering fire evacuation, emergency assembly points, and incident reporting. Annual refresher training is delivered online and takes approximately forty-five minutes to complete.',
      'Laboratory safety requires closed-toe shoes, safety glasses, and the use of fume hoods for all chemical work. Visitors to the lab must be escorted and sign the visitor safety acknowledgment before entering the restricted work areas.',
      'The safety committee, composed of representatives from each department, inspects the facilities monthly and publishes findings in the company newsletter. Employees may submit safety suggestions anonymously through the suggestion box.',
    ],
  },
  {
    title: '8. Recruitment and Referral',
    points: [
      'Hiring decisions are based solely on qualifications, skills, and potential. Discrimination on any protected basis is prohibited in every stage of recruitment, and interview panels must include at least one member trained in unbiased interviewing techniques.',
      'Employee referrals are encouraged with a bonus of 3000 CNY paid after the referred candidate completes six months of employment. The referring employee must not participate in the interview loop for their referral at any stage.',
      'All candidates are entitled to reasonable accommodation during the interview process, including sign language interpreters, wheelchair access, or alternative interview formats. Requests should be made at least three days before the scheduled interview.',
      'Offer letters are valid for seven calendar days. Background checks covering education, employment history, and criminal records are conducted with the candidate written consent before the start date of the new employee.',
      'Internships are offered year-round to students in their penultimate year of study. The internship program lasts three to six months, includes a dedicated mentor, and pays a monthly stipend of 4000 CNY plus travel subsidies.',
      'Interview feedback must be submitted within 24 hours of the interview through the applicant tracking system. Feedback should evaluate specific competencies from the role scorecard rather than general impressions or personal characteristics.',
      'Counter-offers made by the current employer of a candidate are discussed openly. The hiring manager and HR review whether the role expectations match the candidate long-term goals before proceeding with the final offer of employment.',
      'Internal mobility is supported: employees who have been in their role for at least eighteen months may apply for open positions, and their current manager cannot block a transfer without a documented business reason approved by HR.',
      'Recruiting agencies may be used for specialist roles. Agency fees are capped at twenty percent of the first-year base salary, and agencies must sign the diversity sourcing agreement before any candidate submission takes place.',
      'All candidate data is stored in the recruiting system for two years with consent, after which it is anonymized. Candidates may request deletion of their data at any time by contacting the privacy office of the company.',
    ],
  },
  {
    title: '9. Training and Development',
    points: [
      'Each employee has an annual training budget of 2000 CNY for courses, books, and certifications. The budget resets on January 1st and does not carry over. Approval from the manager is required for expenses above 500 CNY.',
      'New hires complete a structured onboarding program covering company values, systems access, and role-specific training. A buddy is assigned for the first ninety days to help with day-to-day questions and cultural integration.',
      'Technical staff are encouraged to spend four hours per week on learning activities, including internal tech talks, online courses, or open source contributions. Learning time should be scheduled in the team calendar like any other meeting.',
      'Leadership development programs run twice per year for employees identified as high potential through the annual review process. The six-month program includes mentoring by a senior executive and a cross-functional team project.',
      'Conference attendance is supported with up to five days of paid conference leave per year. Employees who attend must share their learnings through a lunch-and-learn session or an internal blog post within two weeks of returning.',
      'Professional certification fees are reimbursed upon passing the exam. Employees who fail may retake the exam once at company expense, provided they complete a study plan agreed with their manager before the retake date.',
      'Language training is available for employees working with international teams. The program includes weekly group classes and a self-study platform license, with a target of one proficiency level improvement per year of study.',
      'Performance reviews are conducted twice per year, focusing on development goals rather than just rating. Each review produces a growth plan with two to three concrete objectives, resources needed, and milestones for the next six months.',
      'Internal trainers receive a bonus of 500 CNY per half-day session delivered. Course materials are shared in the learning management system, and employees who complete ten internal courses per year receive a certificate of continuous learning.',
      'Tuition reimbursement for part-time degree programs covers fifty percent of tuition up to 10000 CNY per year, with a service agreement requiring the employee to remain with the company for two years after completing the program successfully.',
    ],
  },
  {
    title: '10. Confidentiality and Data Protection',
    points: [
      'Confidential information includes client lists, product roadmaps, source code, pricing, and unpublished financial results. Such information may be shared only with colleagues who have a genuine business need to know it.',
      'Personal data of employees and customers is processed in accordance with applicable data protection laws. Access to personal data is restricted to the HR, payroll, and support teams, and all access is logged for audit purposes.',
      'Data classification labels (public, internal, confidential, restricted) must be applied to all documents. Restricted documents require encryption at rest and in transit, and may not be shared outside the company under any circumstances.',
      'The privacy office handles all data subject requests, including access, correction, and deletion of personal data, within fifteen business days as required by law. Requests may be submitted through the privacy portal.',
      'Source code is a trade secret of the company. Code may not be copied to personal repositories, pasted into public forums or AI tools, or disclosed to third parties. Git access is granted per repository with two-factor authentication enforced.',
      'Customer contracts include confidentiality obligations that survive for five years after the contract ends. Employees working on customer accounts must complete the customer confidentiality acknowledgment before receiving account access.',
      'Data breaches must be reported to the security team immediately and no later than two hours after discovery. The incident response plan requires notification to affected parties and regulators within seventy-two hours when legally required.',
      'Printed confidential documents must be collected immediately from printers and shredded in the designated bins. Clean desk policy applies at the end of each workday, and screens should be positioned to prevent shoulder surfing by visitors.',
      'Exit procedures for departing employees include revocation of all access on the final day, return of all devices and documents, and a reminder of ongoing confidentiality obligations, which continue indefinitely after employment ends.',
      'Cross-border data transfers are permitted only to countries with adequate data protection standards or under approved contractual safeguards approved by the legal team. Employees must consult the privacy office before transferring any data abroad.',
    ],
  },
];

const doc = new PDFDocument({ size: 'A4', margin: 50 });
doc.pipe(fs.createWriteStream(outPath));

doc.fontSize(18).text('Employee Handbook 2026', { align: 'center' });
doc.moveDown(0.5);
doc
  .fontSize(11)
  .text('Internal use only. This handbook summarizes company policies for all employees.', {
    align: 'center',
  });
doc.moveDown();

sections.forEach((section, i) => {
  if (i > 0) {
    doc.addPage();
  }
  doc.fontSize(14).text(section.title, { underline: true });
  doc.moveDown(0.5);
  for (const point of section.points) {
    doc.fontSize(10.5).text(point, { lineGap: 2 });
    doc.moveDown(0.5);
  }
});

doc.end();
console.log(`generated: ${outPath}`);
