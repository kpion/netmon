
function init(){
    document.querySelector('h1').style.color = '#ada';
}

if (document.readyState === "loading") {//might be 'loading' or 'complete'
    document.addEventListener("DOMContentLoaded", init);
} else {//dom already loaded, so the above event will never fire, so:  
    init();
}

