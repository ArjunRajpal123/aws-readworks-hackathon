*Draft concept for the ReadWorks x AWS hackathon team, Nov 3, 2026. A research-based memo, not a ReadWorks position. AI-generated content may contain errors; check every citation against the original before using it publicly.*

# Making Sound Along different: what the learning research supports

## The short version

**Constraint from the team:** it must not be the same application as the others, and it must still fit into the existing ReadWorks platform. So the differences below live in how the support behaves and what it teaches, inside ReadWorks's own page frame (see "Fitting into ReadWorks's platform").

1. If every entry offers "listen, highlight the word, tap for a definition", that is the brief, not a difference. The research says that package helps less than people assume, so the better pitch is **audio as a scaffold that fades**, not audio as a permanent crutch.
2. The strongest evidence in the whole literature is for **practice testing and spaced practice**, not for read-aloud highlighting. ReadWorks already ships question sets, so we can build retrieval practice into the player without any AI at runtime.
3. **Phrase-level reading support** has more direct evidence for reading with expression than word-by-word karaoke highlighting. Few products do it.
4. **Morphology (word parts) and cognates** are the vocabulary levers with research behind them, and the cognate work fits ReadWorks's Spanish passages.
5. **Restraint is a design choice with evidence behind it.** Extra digital features can distract, especially for children from disadvantaged backgrounds. A calm interface that helps at the right moment is both different and defensible.
6. Our four grade bands should be sold as **four different teaching strategies**, not four skins.

## What the research says about the baseline feature

| Finding | Strength and caveats |
|---|---|
| Reading while listening gave a **small** comprehension benefit overall (g = 0.18, 30 studies, 1,945 learners). The benefit appeared **only when the pace was controlled** by the researcher; self-paced reading showed no reliable effect. Evidence for struggling readers specifically is thin. | A 2023 systematic review and meta-analysis. I could not confirm the paper's title from the link I found; check it. |
| A synthesis of 19 studies of secondary struggling readers found fluency improved when the intervention included **listening to a model read the passage before reading it**. | A preview design, not simultaneous listening. |
| A ReadWorks and Digital Promise study (Grades 1 to 6, 1,857 students) found 92% tried at least one optional support, and students engaged with **more challenging** passages when they used supports such as audio. | Authors are Digital Promise staff. It measures engagement with harder text, not measured reading gains. |
| Digital books that were only digitised (no added features) produced **lower** comprehension than print for young children; enhancements that supported the story did better; an embedded dictionary helped **vocabulary** but had no or negative effect on **comprehension**. Disadvantaged children were more distracted by interactive features. | A meta-analysis of 39 studies of children aged 1 to 8. Findings are about young children and story books, so applying them to Grade 4 and above is an inference. |

What this means: do not claim audio improves comprehension in general. Claim what the evidence supports: audio lets students meet harder text, previewing a fluent model builds fluency, and the benefit depends on how the support is paced.

## Proposed differentiators, in the order I would build them

### 1. The scaffold dial (listen, follow, echo, your turn)

**What the student sees.** One control with four steps instead of an audio on/off switch. *Listen*: full audio with highlight. *Follow*: the audio reads a phrase while only that phrase is cued. *Echo*: the audio reads one sentence, then pauses so the student reads it themselves before the next one. *Your turn*: no audio, tap any word or sentence to hear it. A teacher sets the starting step, and the student can move down as they gain confidence.

**Why.** The comprehension benefit of simultaneous listening is small and depends on pacing (above), while hearing a model before reading is the design with consistent fluency gains. A dial that fades support builds on that. Repeated readings also matter, so replaying a passage at a lower support level is a natural next step.

**Distinct because** competitors with an on/off switch cannot show a path from supported reading to independent reading.

**Size.** Medium. We already have word times, sentence marks and tap-to-replay. Echo and Follow need pause points (sentence ends from the existing marks, phrases from commas).

**Caution.** The dial itself has not been tested as a product feature. Pitch it as grounded in the evidence on previewing and fading, and plan a pilot to measure it.

### 2. Phrase-level cueing instead of only word-by-word highlighting

**What the student sees.** An option to cue the current *phrase* (a chunk of a sentence) rather than lighting each word, with a thin boundary mark between phrases.

**Why.** In a study of second graders, reading with natural prosody was most strongly helped by repeated readings of **phrase-cued text**. A small single-case study of ten children in grades 1 to 3 also found gains in expression and phrasing. For karaoke-style word highlighting, the one study I found showed benefits on the trained text but **no transfer** to untrained text.

**Distinct because** most read-along tools highlight single words.

**Size.** Small to medium. Phrase boundaries can start from punctuation and sentence marks; better boundaries would need a language-aware step in the pipeline.

**Caution.** The studies are small and I found no large randomised trial. Treat it as a research-informed option and keep word highlighting as the default.

### 3. Retrieval practice built in: questions as low-stakes quizzes, with spaced return

**What the student sees.** After reading, a short "check yourself" using the ReadWorks question set (already in the demo). Missed items and vocabulary words come back later ("see it again tomorrow") rather than only at the end of the session. Before revealing an answer, a quick "how sure are you?" with three levels.

**Why.** Practice testing is one of the two techniques rated high utility in a widely cited review of learning techniques, along with distributed practice. A meta-analysis of practice testing reported an average benefit around g = 0.6 (sources I found give 0.61 and 0.70 for different models), with the largest effects when the test came one to six days after the practice. A meta-analysis of classroom studies of distributed over massed practice found d = 0.54. For the confidence step: children in grades 3 to 6 corrected high-confidence errors more readily than low-confidence ones (the hypercorrection effect), but the effect fades over a week.

**Distinct because** it turns audio support into durable learning rather than a one-time listen, and it uses content ReadWorks already owns.

**Size.** Medium. The question player exists. Cross-session spacing needs student accounts, which the sandbox does not have, so in the demo we can show a "tomorrow" view with a simulated clock.

**Caution.** Much of the testing and spacing evidence is laboratory-based or measures recall of facts, not deep comprehension. Do not promise comprehension gains.

### 4. A Spanish bridge and word-parts lab

**What the student sees.** In a Spanish-English view, cognates are marked in the passage with a short "this looks like" link to the Spanish word. In the word card, a word-parts view shows the root and affixes and a few related words.

**Why.** Cognate instruction is a researched route to English vocabulary for Spanish-speaking learners, and studies note that students often do not notice cognates **without explicit instruction**. For word parts, a meta-analysis of 30 studies found a moderate overall effect of morphological instruction (d = 0.32 as reported), and an earlier analysis of children with literacy difficulties reported a larger effect for struggling readers (about 0.46).

**Distinct because** it uses ReadWorks's paired English and Spanish texts for something no generic read-aloud tool can do.

**Size.** Small for a demo with the data we already have (cognate chips and word parts exist in the cards); medium to scale through the pipeline.

**Caution.** Effect sizes here are secondhand from search summaries. Verify them in the papers before quoting.

### 5. Calm help: choose when the help appears

**What the student sees.** A setting for *help during reading* (current behaviour: tap to open the panel) or *help after the sentence or passage* (taps are collected and shown together afterwards). Animations off by default for students who select calm mode.

**Why.** The digital-book evidence above suggests added features can hurt comprehension and distract some children more than others, while still helping vocabulary. Letting teachers choose the timing of help is a response to that tension.

**Size.** Small. The side panel and queue pattern are already there.

**Caution.** This is a design hypothesis built on an inference from younger children. It is the best candidate to test in a pilot, not a proven benefit.

### 6. A teacher view of where students struggled (synthetic data in the demo)

**What the teacher sees.** For a passage, the words and sentences students replayed most, and the questions most often missed. It points to where comprehension broke down, which is what formative assessment is for.

**Why.** I did not research this one; the argument is design reasoning. The brief lists analytics as a later phase, so a mock with clearly labelled synthetic data shows the direction without overreaching.

**Size.** Small as a mock. Real data needs accounts and a privacy design.

## Fitting into ReadWorks's platform (the constraint)

**Principle: differentiate the learning layer, not the chrome.** The page frame, colours, type and patterns stay ReadWorks's own, so every addition looks like a feature they built. What makes us different is how the support behaves, not how the page is dressed.

What their live passage page uses (read from the public site): a teal top bar, a pale title band with Assign and Print buttons, tabs (Passage, StepReads, Vocabulary Activity, Question Set), a grey pill audio player with a separate Speed chip, and a DETAILS and RELATED sidebar. Roboto headings over a Helvetica Neue body, teal `#007693`, text `#344048`, 5 px corners.

| Their existing element | What we do inside it |
|---|---|
| Audio pill and Speed chip | Keep the pill and its place. Add a **Support** chip beside Speed for the scaffold dial. Highlight in the passage text, with a word or phrase option |
| Passage tab text | Swap `content` for the tokenised version (`contentTokenized`) so words can be timed and tapped. No layout change; vocabulary spans keep their markup |
| DETAILS sidebar | Our word panel sits here on desktop and slides in on phones. Their Details list stays as it is |
| Vocabulary list and Vocabulary Activity tab | Our word cards and "come back tomorrow" words feed these, rather than creating a second list |
| Question Set tab | The same ReadWorks questions, with "Hear it" read-aloud, retry, and a confidence check added |
| Assign button and flow | The teacher chooses the starting support step, grade-band look and game features when assigning, as they already do for audio |
| Content management | Separate staff area (the tech brief puts content management on its own server) |

**How it plugs in.** Vue 3 components inside their existing front end (the brief names Vue 3), reading the product JSON they already serve plus the audio and timing files in S3. No iframe. Switched on per assignment, and **falls back to today's audio** when a passage has no `soundAlong` block, so rollout can be gradual.

**A visual signature that is still native: the reading ribbon.** A slim segmented bar under the audio pill, one segment per sentence. It shows where you are, which sentences were replayed, and later which sentences hold the evidence for a question. It reads as part of the audio pill, but it carries learning information. It is the one thing a judge can point at and say "that is theirs".

**Where today's demo departs from their platform, and what I would change.**
- The "Sound Along" label in the bar would be the ReadWorks logo in a real integration.
- The Glow firefly (K-2) and the case-file look (3-5) are the least native. I would show them only when the teacher turns **Game features** on, and make the default look the ReadWorks-native one for every band. The 6-8 and 9-12 looks are already close.
- The "Concept mockup" label and the Admin banner are demo-only.

**Three layers of difference without different chrome.** *Behaviour* (the scaffold dial and phrase cueing), *evidence* (retrieval practice with spaced return), and *inclusion* (the Spanish bridge and the whole-platform Spanish). None of them need a redesign of the page.

## The four bands as four teaching strategies

| Band | Strategy the interface leads with | Evidence base |
|---|---|---|
| K-2 | Hearing the word and seeing it together; picture-based choices; voice-first controls | Early decoding and vocabulary support (not re-researched here) |
| 3-5 | Using context clues to work out a word | A meta-analysis of 21 studies found instruction in deriving word meaning from context had an effect of 0.43 SD (cited in the build pack) |
| 6-8 | Word parts: roots and affixes | Morphology meta-analyses above |
| 9-12 | Annotating and arguing from the text | Not researched here; pair with evidence-highlighted questions |

This is the story that makes the modes look different for a reason, not just a different skin.

## What I would not lead with

- **Dyslexia fonts.** I found no direct evidence for them. What has evidence is **extra-large letter spacing**: Zorzi and colleagues (2012) reported that it improved reading accuracy and speed in children with dyslexia, with no gain for typical readers. Our "wider spacing" option is the defensible one; keep claims about the "easy-to-read font" modest. Reported sample sizes differ between news stories, so check the paper.
- **Speech-recognition reading tutors.** A randomised trial of Project LISTEN met the What Works Clearinghouse standard and showed a significant gain on a total reading composite, but not on oral reading fluency or comprehension alone. Recording children's voices also raises privacy questions. Treat it as a later, optional feature.
- **Claiming comprehension gains from audio highlighting.** See the first table.

## How strong is this evidence?

- I searched summaries of each literature and read result snippets, not the full papers. Several figures come from secondary summaries (news stories, abstracts, mirrors). They are marked above where I am least sure.
- Not independently checked here: the Fukkink and de Glopper figure (cited in the build pack), multimedia-learning principles, Universal Design for Learning, the evidence for the K-2 and 9-12 strategies, and anything about formative-assessment dashboards.
- Hackathon note: all of this should be described as "research-informed", with the pilot measures named, not as proven outcomes.

## Suggested order

1. **Scaffold dial with Follow and Echo** (biggest visible difference, builds on what exists).
2. **Retrieval practice with confidence check and a "come back tomorrow" view** (strongest evidence, uses ReadWorks questions).
3. **Spanish bridge and word-parts lab** (fits the paired-text data and the whole-platform Spanish work).
4. **Calm help setting**, then the **teacher view mock** if time allows.
5. Keep the **measured scale run** and the **blind listening test** from the earlier list; they speak to the brief's cost and voice-quality measures.

## Sources

- Reading while listening meta-analysis (2023, 30 studies): https://commons.und.edu/ehb-fac/75 (first search result; title not shown, confirm it is the paper)
- Fluency interventions for secondary struggling readers: https://meadowscenter.org/library/a-synthesis-of-fluency-interventions-for-secondary-struggling-readers/
- ReadWorks and Digital Promise audio and supports study (Tare, Shell and Jackson, 2020): https://informahealthcare.com/doi/abs/10.1080/15391523.2020.1821412
- Phrase-cued text and prosody: https://digitalcommons.lib.uconn.edu/dissertations/AAI3166001 and https://citedrive.com/en/discovery/pairing-phrasecued-text-with-readers-theatre-effects-on-reading-prosody-and-automaticity
- Digital versus paper books, children (Furenes, Kucirkova and Bus, 2021): https://doi.org/10.3102/0034654321998074 and https://www.aera.net/Newsroom/A-Comparison-of-Childrens-Reading-on-Paper-Versus-Screen-A-Meta-Analysis
- Practice testing meta-analysis (Adesope and colleagues, 2017): https://education.wsu.edu/documents/2018/01/rethinking-use-tests.pdf/
- Review of learning techniques (Dunlosky and colleagues, 2013): https://www.readingrockets.org/resources/resource-library/improving-students-learning-effective-learning-techniques-promising
- Distributed practice: https://pmc.ncbi.nlm.nih.gov/articles/PMC12189222/ (classroom meta-analysis) and https://pubmed.ncbi.nlm.nih.gov/16719566/ (Cepeda and colleagues, 2006)
- Hypercorrection: https://peeref.com/works/59714535 (children, 2011) and https://pubmed.ncbi.nlm.nih.gov/29781391/ (classroom, 2018)
- Morphological interventions: https://apps.asha.org/EvidenceMaps/Articles/ArticleSummary/93cb3843-8a27-4b52-887b-32781be13e92
- Cognates: https://www.cal.org/vias/subproject4/index.html, https://ies.ed.gov/use-work/awards/content-based-vocabulary-instruction-using-cognates-promote-vocabulary-development-and-reading, https://link.springer.com/article/10.1007/s11145-018-9821-1
- Letter spacing and dyslexia (Zorzi and colleagues, 2012): https://ccnl.psy.unipd.it/publications/publications_folder/extra-large-letter-spacing-improves-reading-in-dyslexia/view
- Adjunct questions: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10886187/
- Reading tutor with speech recognition (Project LISTEN randomised trial): https://ies.ed.gov/ncee/WWC/Study/95240
