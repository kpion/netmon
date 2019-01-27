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
    },

    /**
     * adds ... to a string if longe than 'maxLen'
     */
    ellipsis (string, maxLen){
        if (string.length >= maxLen)
           return string.substring(0,maxLen-1)+'...';
        else
           return string;
     },    

    //see  colorFromNumber
    rgbFromNumber(num){
        return {
                'r' : Math.abs(num % 255),
                'g' : Math.abs((num % 255) * 40) % 255,
                'b' : Math.abs((num % 255) * 80) % 255,
            };
    },

    /**
     * will try to 'make' a color based on arbitrary number (from 0 to ... whatever).
     * used e.g. to colorize tab IDs in such a way, that tab 1001 will differt greatly (in color) from 10002;
     * @return {string} e.g. rgb(10,20,300);
     */
    colorFromNumber(num){
        const c = this.rgbFromNumber(num);
        return `rgb(${c.r},${c.g},${c.b})`;
    },  

    //used by distinctColorFromNumber, taken from: https://sashat.me/2017/01/11/list-of-20-simple-distinct-colors/
    distinctColors : [
        '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', 
        '#bfef45', '#fabebe', '#469990', '#e6beff', '#9A6324', '#fffac8', '#800000', '#aaffc3', 
        '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#ffffff', '#000000'],
    /**
     * returns a 'distinct' color from a number, used e.g. to colorize tabId's which can be any number
     * from 0 to ... a lot of. 
     * */    
    distinctColorFromNumber(num){
        return this.distinctColors[num % this.distinctColors.length];
    }
};