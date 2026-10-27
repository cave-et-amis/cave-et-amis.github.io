// Moteur des animations, chargé à part juste après le démarrage (voir MotionProvider). domMax plutôt que domAnimation :
// seul domMax sait animer la mise en page (`layout`), quand une ligne est ajoutée ou retirée d'une liste.
export { domMax as default } from 'motion/react';
