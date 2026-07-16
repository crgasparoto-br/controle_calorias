# Issue 801 focused validation

Commit validated: b4f49b5200f9b96dc1e397bd94fe9f81784f221a

Exit code: 1

```text

[1m[7m[36m RUN [39m[27m[22m [36mv2.1.9 [39m[90m/home/runner/work/controle_calorias/controle_calorias[39m

 [32m✓[39m client/src/pages/foodsPageState.test.ts [2m([22m[2m4 tests[22m[2m)[22m[90m 5[2mms[22m[39m
 [31m❯[39m server/modules/foods/sleepKoalaRegression.test.ts [2m([22m[2m1 test[22m[2m | [22m[31m1 failed[39m[2m)[22m[90m 19[2mms[22m[39m
[31m   [31m×[31m Sleep Koala deletion regression[2m > [22mdeprecia a associação antiga, limpa os stores e persiste a classificação atual[90m 17[2mms[22m[31m[39m
[31m     → expected [ Array(2) ] to deeply equal [ ObjectContaining{…} ][39m
 [32m✓[39m server/modules/insights/service.test.ts [2m([22m[2m5 tests[22m[2m)[22m[90m 39[2mms[22m[39m

[31m⎯⎯⎯⎯⎯⎯⎯[1m[7m Failed Tests 1 [27m[22m⎯⎯⎯⎯⎯⎯⎯[39m

[31m[1m[7m FAIL [27m[22m[39m server/modules/foods/sleepKoalaRegression.test.ts[2m > [22mSleep Koala deletion regression[2m > [22mdeprecia a associação antiga, limpa os stores e persiste a classificação atual
[31m[1mAssertionError[22m: expected [ Array(2) ] to deeply equal [ ObjectContaining{…} ][39m

[32m- Expected[39m
[31m+ Received[39m

[2m  Array [[22m
[2m    ObjectContaining {[22m
[2m      "id": 21,[22m
[2m      "isFavorite": false,[22m
[2m      "status": "deprecated",[22m
[2m    },[22m
[31m+   Object {[39m
[31m+     "brandName": null,[39m
[31m+     "calories": 104,[39m
[31m+     "carbs": 7.8,[39m
[31m+     "createdByUserId": null,[39m
[31m+     "fat": 5.5,[39m
[31m+     "fiber": null,[39m
[31m+     "foodType": "generic",[39m
[31m+     "id": 21,[39m
[31m+     "isFavorite": false,[39m
[31m+     "isFruit": false,[39m
[31m+     "isUltraProcessed": false,[39m
[31m+     "isUserCreated": false,[39m
[31m+     "isVegetable": false,[39m
[31m+     "lastUsedAt": null,[39m
[31m+     "name": "Iogurte natural integral",[39m
[31m+     "processingLevel": "natural_or_minimally_processed",[39m
[31m+     "protein": 5.9,[39m
[31m+     "servingSize": 170,[39m
[31m+     "servingUnit": "g",[39m
[31m+     "source": "catalog",[39m
[31m+   },[39m
[2m  ][22m

[36m [2m❯[22m server/modules/foods/sleepKoalaRegression.test.ts:[2m160:5[22m[39m
    [90m158| [39m      )
    [90m159| [39m    )[33m.[39m[34mtoBe[39m([35mfalse[39m)[33m;[39m
    [90m160| [39m    [35mawait[39m [34mexpect[39m(foodsService[33m.[39m[34mgetFoodsByIds[39m([34m7[39m[33m,[39m [created[33m.[39mid]))[33m.[39mresolves…
    [90m   | [39m    [31m^[39m
    [90m161| [39m      expect[33m.[39m[34mobjectContaining[39m({
    [90m162| [39m        id[33m:[39m created[33m.[39mid[33m,[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m

[2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m2 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m9 passed[39m[22m[90m (10)[39m
[2m   Start at [22m 22:46:13
[2m   Duration [22m 788ms[2m (transform 507ms, setup 0ms, collect 901ms, tests 63ms, environment 1ms, prepare 259ms)[22m


::error file=/home/runner/work/controle_calorias/controle_calorias/server/modules/foods/sleepKoalaRegression.test.ts,title=server/modules/foods/sleepKoalaRegression.test.ts > Sleep Koala deletion regression > deprecia a associação antiga%2C limpa os stores e persiste a classificação atual,line=160,column=5::AssertionError: expected [ Array(2) ] to deeply equal [ ObjectContaining{…} ]%0A%0A- Expected%0A+ Received%0A%0A  Array [%0A    ObjectContaining {%0A      "id": 21,%0A      "isFavorite": false,%0A      "status": "deprecated",%0A    },%0A+   Object {%0A+     "brandName": null,%0A+     "calories": 104,%0A+     "carbs": 7.8,%0A+     "createdByUserId": null,%0A+     "fat": 5.5,%0A+     "fiber": null,%0A+     "foodType": "generic",%0A+     "id": 21,%0A+     "isFavorite": false,%0A+     "isFruit": false,%0A+     "isUltraProcessed": false,%0A+     "isUserCreated": false,%0A+     "isVegetable": false,%0A+     "lastUsedAt": null,%0A+     "name": "Iogurte natural integral",%0A+     "processingLevel": "natural_or_minimally_processed",%0A+     "protein": 5.9,%0A+     "servingSize": 170,%0A+     "servingUnit": "g",%0A+     "source": "catalog",%0A+   },%0A  ]%0A%0A ❯ server/modules/foods/sleepKoalaRegression.test.ts:160:5%0A%0A
```
