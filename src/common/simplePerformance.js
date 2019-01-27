/*
Just a simpler way to measure execution time of ... things
http://jsfiddle.net/kpion/e0pw9kvb/

Usage:
console.clear();
simplePerformance.mark('mark 1');    
//doing some lengthy operation.....
console.log(simplePerformance.mark('mark 2')); //this will store the 'mark 2' mark and 
also print the time since the previous mark.
console.log(simplePerformance.getReport());//times of specific marks.
*/
const simplePerformance = {
    
    //array of [<markName>,<timeInMs>]
    marks: [], 
    
    /**
     * adds a 'mark' and returns a time passed since the last one 
     */
    mark(name = ''){
        const ret = this.time();
        this.marks.push([name,this.now()]);
        return ret;
    },
    
    /** 
     * returns time from the last mark (to *now*)
     */ 
    time(){
        if(this.marks.length === 0){//no marks
            return 0;
        }
        return this.now() - this.marks[this.marks.length -1][1];
    },
    
    /**
     * 'custom' version of .now()
     */ 
    now(){
        if(typeof performance === 'object'){
            return performance.now();
        }
        return Date.now();
    },
    
    /**
     * times of specific marks.
     */
    getReport(){
        let report = [];
        let prev = -1;
        this.marks.forEach(m => {
            let passed = prev == -1? 0: m[1]-prev;
            report.push({mark:m[0],'time':passed});
            prev = m[1];
        })
        return report;
    },    
    getMarks(){
        return this.marks;
    },
    clearMarks(){
        this.marks = [];
    }
    
}