import {t} from './i18n.js';

const EMOJIS=[
 ['😀','grinning'],['😃','smile'],['😄','smile happy'],['😁','grin'],['😆','laugh'],['😅','sweat laugh'],['😂','joy laugh'],['🙂','slight smile'],['😉','wink'],['😊','blush'],['😍','heart eyes love'],['🥰','hearts love'],['😘','kiss'],['😎','cool'],['🤩','star struck'],['🥳','party celebration'],['😭','cry'],['😴','sleep'],['🤗','hug'],['🤍','white heart'],
 ['❤️','red heart love'],['🧡','orange heart'],['💛','yellow heart'],['💚','green heart'],['💙','blue heart'],['💜','purple heart'],['🖤','black heart'],['💖','sparkling heart'],['💝','gift heart'],['💕','two hearts'],['💐','bouquet flowers'],['🌸','cherry blossom'],['🌹','rose'],['🌷','tulip'],['🌻','sunflower'],['🌿','leaf'],['🍀','clover luck'],['✨','sparkles'],['⭐','star'],['🌈','rainbow'],
 ['🎉','party popper'],['🎊','confetti'],['🎈','balloon'],['🎂','birthday cake'],['🍰','cake'],['🥂','cheers champagne'],['🍾','champagne'],['🍷','wine'],['🍸','cocktail'],['🍹','drink'],['🕯️','candle'],['🎁','gift present'],['💍','ring wedding'],['💒','wedding'],['👰','bride'],['🤵','groom'],['💃','dance'],['🕺','dance'],['🎶','music'],['🎵','note'],
 ['📸','camera photo'],['📷','camera'],['💌','love letter'],['💫','dizzy'],['🔥','fire'],['🥂','toast'],['🍓','strawberry'],['🍋','lemon'],['🍇','grapes'],['🍰','dessert'],['🍽️','dining'],['🏖️','beach'],['🌅','sunset'],['🌙','moon'],['☀️','sun'],['🪩','disco'],['🎆','fireworks'],['🎇','sparkler'],['🧸','teddy'],['🫶','heart hands']
];

export function emojiPickerMarkup(id){return `<div class="emoji-picker" id="${id}" hidden><input id="${id}-search" type="search" aria-label="Search emoji" placeholder="Search emoji"><div class="emoji-picker-grid" role="group" aria-label="Emoji choices">${EMOJIS.map(([emoji,label])=>`<button type="button" data-emoji="${emoji}" data-search="${label}" aria-label="${t(label)}" title="${t(label)}">${emoji}</button>`).join('')}</div><p class="emoji-empty" hidden>No emoji found.</p></div>`;}

export function wireEmojiPicker(button,picker,onChoose){
 const search=picker.querySelector('input'),grid=picker.querySelector('.emoji-picker-grid'),empty=picker.querySelector('.emoji-empty');
 const close=()=>{picker.hidden=true;button.setAttribute('aria-expanded','false');};
 button.setAttribute('aria-expanded','false');button.onclick=()=>{picker.hidden=!picker.hidden;button.setAttribute('aria-expanded',String(!picker.hidden));if(!picker.hidden)search.focus();};
 search.oninput=()=>{const query=search.value.trim().toLocaleLowerCase();let visible=0;grid.querySelectorAll('[data-emoji]').forEach(item=>{const show=item.dataset.search.toLocaleLowerCase().includes(query)||item.getAttribute('aria-label').toLocaleLowerCase().includes(query);item.hidden=!show;if(show)visible++;});empty.hidden=visible>0;};
 grid.onclick=event=>{const item=event.target.closest('[data-emoji]');if(item){onChoose(item.dataset.emoji);close();}};
 picker.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 const outside=event=>{if(!picker.hidden&&!picker.contains(event.target)&&!button.contains(event.target))close();};document.addEventListener('pointerdown',outside);
 return()=>document.removeEventListener('pointerdown',outside);
}
