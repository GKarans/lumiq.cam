import {language,locale,t} from './i18n.js';

export function galleryCount(visible,total){return language()==='lv'?`${visible} no ${total} foto`:`${visible} of ${total} photos`;}
export function galleryUpdated(at=new Date()){return `${t('Updated')} ${new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at)}`;}
