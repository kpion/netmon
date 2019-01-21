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
    
    /**
     * Deletes the very first N elements of a Map. In the insertion order.
     * @param {Map} map 
     * @param {int} count 
     */
    deleteMapHead(map, count = 1){
        const keys = map.keys();
        let index = 0;
        for (var key of keys) {
    	    map.delete(key);
    	    if(++index >= count){
    	        break;
    	    }
        }
    },

    /**
     * 
     * @param {number} timeSpan miliseconds
     */
    formatTimeSpan(timeSpan, digits = 2){
        if(timeSpan < 1000){
            return timeSpan.toFixed(digits) + ' ms';
        }else if(timeSpan < (1000 * 60)){
            return (timeSpan / 1000).toFixed(digits) + ' s';
        }else {
            return (timeSpan / (1000 * 60)).toFixed(digits) + ' min';
        };
    }
};