#include "basket.h"
#include <iostream>

int main() {
    CBasket basket;
    basket.addStock("RELIANCE", TPlanParams{.nYears = 10, .nWinMin = 10, .nWinMax = 31});

    CAUTOREF windows = basket.getWindows("RELIANCE");
    std::cout << "RELIANCE windows: " << windows.size() << "\n";

    CAUTOREF years = basket.getYears("RELIANCE");
    std::cout << "Years used: ";
    for(CAUTO y : years) std::cout << y << " ";
    std::cout << "\n";

    CAUTOREF stats = basket.getWindowStats("RELIANCE");
    std::cout << "Window stats (after filtering): " << stats.size() << "\n";
    for(CAUTOREF ws : stats) {
        std::cout << "  [" << ws.iBeg << "-" << ws.iEnd << "]"
                  << " win=" << ws.pctWin << "%"
                  << " exp=" << ws.pctExpected << "%"
                  << " pr=" << ws.fProfitRatio
                  << " gains=[";
        for(i32 i = 0; i < static_cast<i32>(ws.arrYearGains.size()); ++i) {
            if(i) std::cout << ", ";
            std::cout << ws.arrYearGains[i];
        }
        std::cout << "]\n";
    }

    basket.removeStock("RELIANCE");
    std::cout << "after remove: " << basket.getWindows("RELIANCE").size() << "\n";

    return 0;
}
