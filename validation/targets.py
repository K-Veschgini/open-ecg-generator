"""Which ECGFounder labels each synthetic pathology is expected to trigger.
'primary' labels decide pass/fail; 'related' are shown for context only."""
TARGETS = {
    'normal':                 {'primary': ['NORMAL ECG'], 'related': ['NORMAL SINUS RHYTHM', 'SINUS RHYTHM']},
    'bradycardia':            {'primary': ['SINUS BRADYCARDIA'], 'related': ['MARKED SINUS BRADYCARDIA']},
    'tachycardia':            {'primary': ['SINUS TACHYCARDIA'], 'related': []},
    'atrialFibrillation':     {'primary': ['ATRIAL FIBRILLATION'], 'related': ['WITH RAPID VENTRICULAR RESPONSE']},
    'firstDegreeAVBlock':     {'primary': ['WITH 1ST DEGREE AV BLOCK'], 'related': ['WITH PROLONGED AV CONDUCTION']},
    'completeHeartBlock':     {'primary': ['WITH COMPLETE HEART BLOCK'],
                               'related': ['WITH AV DISSOCIATION', 'IDIOVENTRICULAR RHYTHM', 'WITH VENTRICULAR ESCAPE COMPLEXES']},
    'ventricularTachycardia': {'primary': ['VENTRICULAR TACHYCARDIA'], 'related': ['WIDE QRS TACHYCARDIA']},
    'stemi':                  {'primary': ['ACUTE MI / STEMI'],
                               'related': ['INFERIOR INJURY PATTERN', 'INFERIOR INFARCT', 'ACUTE MI']},
    'lbbb':                   {'primary': ['LEFT BUNDLE BRANCH BLOCK'], 'related': []},
    'rbbb':                   {'primary': ['RIGHT BUNDLE BRANCH BLOCK'], 'related': []},
    'lvh':                    {'primary': ['LEFT VENTRICULAR HYPERTROPHY'],
                               'related': ['VOLTAGE CRITERIA FOR LEFT VENTRICULAR HYPERTROPHY', 'WITH REPOLARIZATION ABNORMALITY']},
    'pericarditis':           {'primary': ['ACUTE PERICARDITIS'], 'related': ['EARLY REPOLARIZATION']},
    # ECGFounder has no electrolyte labels: these two cannot be verified with this model.
    'hyperkalemia':           {'primary': [], 'related': []},
    'hypokalemia':            {'primary': [], 'related': ['PROLONGED QT']},
}
