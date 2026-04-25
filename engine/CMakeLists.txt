cmake_minimum_required(VERSION 3.20)
project(meguru)

set(CMAKE_CXX_STANDARD 23)

option(MEGURU_DEBUG "Enable debug logging via printf (routed to console.log in WASM)" OFF)

if(EMSCRIPTEN)
    # -----------------------------------------------------------------
    # WASM build: basket + embind bindings → ES module
    # -----------------------------------------------------------------
    set(CMAKE_EXECUTABLE_SUFFIX ".js")

    add_executable(meguru src/utils.cpp src/plan.cpp src/basket.cpp src/verifycsv.cpp src/bindings.cpp)
    target_include_directories(meguru PRIVATE src)

    if(MEGURU_DEBUG)
        target_compile_definitions(meguru PRIVATE MEGURU_DEBUG)
    endif()

    target_link_options(meguru PRIVATE
        --bind
        -sEXPORT_ES6=1
        -sMODULARIZE=1
        -sEXPORT_NAME=createEngine
        -sALLOW_MEMORY_GROWTH=1
        -sENVIRONMENT=web
        # Detailed abort messages instead of just "Aborted()"
        -sASSERTIONS=2
        # No main — embind-only module
        --no-entry
    )

else()
    # -----------------------------------------------------------------
    # Native build: basket + test harness
    # -----------------------------------------------------------------
    add_executable(meguru src/main.cpp src/utils.cpp src/plan.cpp src/basket.cpp src/verifycsv.cpp)
    target_include_directories(meguru PRIVATE src)

    if(MEGURU_DEBUG)
        target_compile_definitions(meguru PRIVATE MEGURU_DEBUG)
    endif()

endif()
