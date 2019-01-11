/**
 * Just some utililities not really very much specific for this particular app.
 */
utils = {

    /**
     * this one says if a given string looks like it was a regex i.e. it is wrapper in // 
     * '/blah/' true
     * 'blah' false
     * '/blah' false. Same for '//' or just '/'
     * @param {string} s 
     */
    hasRegexDelimeters(s){
        return /^\/.*\/$/.test(s);
    },
    /**
     * escapes any special regex chars, like ,*? etc, so they'll be used very literally. 
     * https://stackoverflow.com/a/9310752/4568686
     * 
     */ 
    escapeRegExp(text) {
        return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    },

    /**
     * DOM: removes all the child nodes of a given node. In some cases better (and surprisingly faster)
     * than using .innerHTML = '';
     */
    removeChildren (parentNode) {
        let last;
        while (last = parentNode.lastChild) {
            parentNode.removeChild(last);
        }
    },
  

};