used by browser action popup and maybe also the full tab with all the requests.

main.js contains everything - table with requests, filters, statistics, buttons like 'pause' etc. It uses table.js

table.js - only serves the `<table>` element.

the html page should contain the following:
```
<table id = 'entriesTable' class="pure-table entriesTable" >
    <thead></thead>
    <tbody></tbody>
</table>  
```    